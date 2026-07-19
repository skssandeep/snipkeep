import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MdAdd,
  MdArchive,
  MdAutoAwesome,
  MdCheck,
  MdCheckCircle,
  MdClose,
  MdContentCopy,
  MdDeleteOutline,
  MdDescription,
  MdEdit,
  MdEvent,
  MdFilterList,
  MdHelpOutline,
  MdInbox,
  MdLightbulb,
  MdLink,
  MdMoreHoriz,
  MdOpenInNew,
  MdSubdirectoryArrowRight,
  MdUndo,
} from 'react-icons/md'
import type {
  DocDestination,
  DocStat,
  DocStats,
  HistoryEntry,
  NotionConfig,
  GetDocTitleMessage,
  GetDocTitleResponse,
  SignInMessage,
  SignInResponse,
  AddDocNoteMessage,
  AddDocNoteResponse,
  AIProvider,
  AIConfig,
  ConnectAIMessage,
  ConnectAIResponse,
  DisconnectAIMessage,
  DisconnectAIResponse,
  AskFollowUpMessage,
  AskFollowUpResponse,
  SummarizeTopicMessage,
  SummarizeTopicResponse,
  OpenStudyMessage,
  FlagConfusionMessage,
  UpdateBibliographyMessage,
  UpdateBibliographyResponse,
} from '../types'
import { Bookmark } from 'lucide-react'
import { timedVideoUrl } from '../lib/video'

type Tab = 'docs' | 'completed' | 'history'

// Opens the full-page study tab (Retrieval Flip's session surface), optionally
// filtered to one doc. Routed through the background — this popup runs in the
// content-script context, which can't open chrome-extension:// URLs itself.
// EXCEPT when the drawer is already open ON the study page (its document IS
// the study page): then navigate this tab in place instead of stacking a
// second study tab.
export function openStudy(destinationId?: string) {
  const studyBase = chrome.runtime.getURL('src/study/')
  if (window.location.href.startsWith(studyBase)) {
    window.location.href = `${studyBase}index.html${destinationId ? `?doc=${encodeURIComponent(destinationId)}` : ''}`
    return
  }
  const msg: OpenStudyMessage = { type: 'OPEN_STUDY', payload: { destinationId } }
  chrome.runtime.sendMessage(msg).catch(() => {})
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Second line on each doc card. Persists across sessions (storage.local).
// Recency-first, with each fact explicitly scoped: the time is the LAST clip
// (not the doc's edit time), the count is the all-time total.
function formatDocMeta(stat?: DocStat): string {
  if (!stat || stat.count === 0) return 'No clips yet'
  return `Last clip ${timeAgo(stat.lastSavedAt)} · ${stat.count} total`
}

// ── Gate Screen ───────────────────────────────────────────────────────────────
// Shown on first run (not signed in). Replaced by the full UI after auth.

function GateScreen({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleClick() {
    setLoading(true)
    setError('')
    try {
      await onSignIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="gate-screen">
      {/* One brand block (icon + name + tagline) held tight, then a clear gap
          to the action — Law of Proximity: identity reads as one unit, the
          button as a separate, deliberate step. */}
      <div className="gate-brand">
        <div className="gate-logo-mark" aria-hidden="true"><Bookmark size={40} strokeWidth={2.5} /></div>
        <div className="gate-logo">Snip<span>Keep</span></div>
        <p className="gate-tagline">Turn what you read<br />into what you remember.</p>
      </div>
      <button className="btn-primary full-width" onClick={handleClick} disabled={loading}>
        {loading ? 'Connecting…' : 'Connect with Google'}
      </button>
      {error && <p className="gate-error">{error}</p>}
    </div>
  )
}

// ── Docs Tab ──────────────────────────────────────────────────────────────────
// The destination docs your clips save into. Auth lives in the drawer header.

function DocsTab({ onJumpToHistory }: { onJumpToHistory: (docName: string) => void }) {
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [newDocId, setNewDocId] = useState('')
  // Always the live Google Doc title (or the 'My Notes' fallback) — never
  // user-editable. It used to be, but syncDocNames() unconditionally
  // overwrites doc.name with the real title on every drawer mount anyway, so
  // a custom name would silently revert the next time the drawer opened —
  // a confusing inconsistency removed by not offering the rename UI at all.
  const [newDocName, setNewDocName] = useState('')
  const [isFetchingTitle, setIsFetchingTitle] = useState(false)
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [notionPageName, setNotionPageName] = useState('')
  const [flash, setFlash] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [docStats, setDocStats] = useState<DocStats>({})
  // destinationId → count of clips saved to it that haven't been cited yet.
  const [uncitedCounts, setUncitedCounts] = useState<Record<string, number>>({})
  // Deadline-Aware Citations: which doc's calendar popup is open, if any.
  const [editingDeadlineFor, setEditingDeadlineFor] = useState<string | null>(null)
  // Which doc's "···" menu (Mark as done / Remove) is open, if any.
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  // Raw clip archive, kept for Summarize (needs each clip's text, not just
  // the uncited count computeUncited derives from the same data).
  const [allClips, setAllClips] = useState<HistoryEntry[]>([])
  // Whether a bring-your-own AI key is connected — gates the "✨ Summarize"
  // menu item; invisible entirely until one exists, per docs/IDEAS.md #3.
  const [aiConnected, setAiConnected] = useState(false)
  const [summaryOpenFor, setSummaryOpenFor] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState('')
  const [summaryStatus, setSummaryStatus] = useState('')

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Lets the visibility-change handler below read the current doc list
  // without re-subscribing its listener every time docs changes.
  const docsRef = useRef<DocDestination[]>([])
  useEffect(() => { docsRef.current = docs }, [docs])

  // FLIP reorder animation for the doc list: when a toggle moves a card (active
  // docs sort above inactive), the card slides to its new spot instead of
  // teleporting. Each render, compare every card's current top to where it was
  // last render; if it moved, play the delta as a slide-into-place.
  //
  // Uses the native Web Animations API (`el.animate()`) rather than hand-toggling
  // CSS `transition`/`transform`, fixing two real bugs the earlier CSS-based
  // version had:
  //  1. `el.style.transition = 'transform ...'` REPLACES the card's own CSS
  //     transition for its hover highlight (`background`/`box-shadow`). Since
  //     the mouse is sitting on the card when its toggle is clicked, that hover
  //     state is live during the slide — so the highlight was snapping instead
  //     of fading, reading as jank even when the slide itself was smooth.
  //     `.animate()` runs as an independent animation layer; it can never touch
  //     or conflict with the element's CSS transitions.
  //  2. It also removes the need for the manual "set instant transform, force
  //     a reflow, then requestAnimationFrame to release it" choreography — the
  //     browser applies the first keyframe deterministically, no timing tricks
  //     or cleanup-on-transitionend required.
  //
  // Two more levers beyond "slower":
  //  - Duration scales with distance traveled — a fixed duration for every
  //    distance breaks the naive-physics expectation that farther = longer.
  //  - A small per-card stagger, so when several cards move at once they
  //    cascade top-to-bottom instead of moving in perfect, robotic lockstep
  //    (real independent objects never move in exact unison).
  //
  // Easing: cubic-bezier(0.65, 0, 0.35, 1) — a pronounced, genuinely symmetric
  // ease-in-out ("easeInOutCubic"). Verified numerically (solving the actual
  // bezier curve, not eyeballing it) before landing on this: Material's
  // "standard" curve, tried previously, has a ZERO tangent at t=0 in theory but
  // still reaches ~24% progress by just 25% of the duration — i.e., very close
  // to linear at the start, not gentle in practice. This curve reaches only ~7%
  // progress by 25% of the duration (and, symmetrically, ~93% by 75%) — a real
  // slow-in AND slow-out, not just a mathematically-technically-nonzero one.
  const cardEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const prevTops = useRef<Map<string, number>>(new Map())
  // Tracks each card's active state as of the last render, so an active↔
  // inactive flip (opacity 1 ↔ 0.5) can be folded into the SAME animate()
  // call as the position slide — see the opacity note below for why.
  const prevActiveMap = useRef<Map<string, boolean>>(new Map())
  // Our own in-flight FLIP animation per card — NOT el.getAnimations(), which
  // would also return the card's CSS hover transitions (box-shadow etc.);
  // cancelling those on interruption would break unrelated hover feedback.
  const runningAnims = useRef<Map<string, Animation>>(new Map())
  // The "Add document" control, tracked separately from cardEls: it's not a
  // doc card, but it's anchored after the LAST ACTIVE card, so a toggle that
  // changes which card that is moves it too — and it used to be the one
  // element in the list that teleported instantly while everything around it
  // glided. It also REMOUNTS as a new DOM node when it moves (it renders
  // inside a different card's Fragment), which is fine for FLIP: position
  // history is keyed by the stable sentinel below, not by element identity.
  const addControlEl = useRef<HTMLElement | null>(null)
  const ADD_CONTROL_KEY = '__add-control'
  // The add-form's input is permanently mounted now (see the addControl
  // comment below), so `autoFocus` — which only fires on mount — is dead;
  // focus explicitly when the form opens instead.
  const addInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (isAdding) addInputRef.current?.focus()
  }, [isAdding])
  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Initial-population guard: docs arrive ASYNC from chrome.storage on
    // every fresh mount (drawer open, tab switch back to Docs), so render 1
    // is always an empty list and render 2 is the populated one. The add
    // control exists in BOTH renders — it's the empty state's only content,
    // sitting at the top — so it alone carries position history across that
    // transition, and FLIP would dutifully animate it from "top of the empty
    // list" down to "after the last active card": a lone ghost slide on
    // every drawer open, over cards that (correctly) don't animate at all.
    // Data arriving is not movement. If no CARD has position history yet,
    // this render is a population, not a reorder — record everything's
    // position, animate nothing.
    const isInitialPopulation = !activeDocs.some(d => prevTops.current.has(d.id))
    // Everything that visibly moves on reorder takes part in the FLIP pass —
    // the doc cards AND the add control. Iterate in current visual order (not
    // Map insertion order) so the stagger index reflects top-to-bottom
    // position; the add control slots in right after the last active card,
    // which is exactly where it renders.
    type Participant = { key: string; el: HTMLElement; index: number; active: boolean }
    const participants: Participant[] = []
    activeDocs.forEach((doc, index) => {
      const el = cardEls.current.get(doc.id)
      if (el) participants.push({ key: doc.id, el, index, active: doc.active })
    })
    if (addControlEl.current) {
      participants.push({ key: ADD_CONTROL_KEY, el: addControlEl.current, index: lastActiveIdx + 1, active: true })
    }

    participants.forEach(({ key, el, index, active }) => {
      // offsetTop (layout-relative), not getBoundingClientRect (viewport-
      // relative): immune to scroll between renders and ignores in-flight
      // transforms, so we compare true layout positions only.
      const nextTop = el.offsetTop
      const prevTop = prevTops.current.get(key)
      const prevWasActive = prevActiveMap.current.get(key)
      let dy = prevTop !== undefined ? prevTop - nextTop : 0

      // Interruption continuity: if this element is still mid-flight from a
      // previous toggle (rapid re-toggling), restarting from the stale layout
      // delta snaps it from wherever it VISUALLY is to a computed start point
      // — the exact "sudden jerk" shape, just on the second click instead of
      // the first. offsetTop deliberately ignores transforms (right for
      // layout truth, wrong for visual truth), so bridge the two: read the
      // in-flight transform/opacity from computed style, fold the transform
      // into the new delta (the new slide then begins at the element's
      // current visual position), carry the in-flight opacity as the new
      // start opacity, and cancel the old animation. Also skip the hold on
      // continuation — an element frozen mid-air for 140ms reads as a hang,
      // not a beat; the hold is for at-rest elements only.
      const prevAnim = runningAnims.current.get(key)
      const interrupted = !!prevAnim && prevAnim.playState !== 'finished'
      let inFlightOpacity: number | null = null
      if (interrupted) {
        // The add control remounts when it moves, so a still-running animation
        // may belong to the DETACHED previous node — its in-flight offset has
        // no meaning for this fresh element. Fold in-flight state only when
        // the running animation actually targets this element.
        const sameEl = (prevAnim.effect as KeyframeEffect | null)?.target === el
        if (sameEl) {
          const cs = getComputedStyle(el)
          if (cs.transform && cs.transform !== 'none') dy += new DOMMatrixReadOnly(cs.transform).m42
          inFlightOpacity = parseFloat(cs.opacity)
        }
        prevAnim.cancel()  // its stale cancel event is ignored — see clearPromotion below
      }

      const positionChanged = prevTop !== undefined && Math.abs(dy) > 1
      const opacityChanged = prevWasActive !== undefined && prevWasActive !== active
      // `interrupted` is a trigger of its own: a quick toggle-back can land on
      // dy ≈ 0 with the same target opacity, but the element is still visibly
      // displaced mid-flight — it needs an animation home, not a snap to rest.
      if (!reduce && !isInitialPopulation && (positionChanged || opacityChanged || interrupted)) {
        // .doc-item.inactive is opacity 0.5 in CSS (see popup.css) — but that
        // CSS transition only ever covered background/box-shadow, never
        // opacity. Toggling active/inactive therefore SNAPPED the dimming
        // instantly, at the exact same moment the slide began: a sharp,
        // un-animated visual change landing right at the start of otherwise
        // smooth motion is exactly what reads as a "jerk," independent of how
        // good the sliding itself is. Folding opacity into this SAME
        // animate() call (rather than a separate CSS transition) guarantees
        // it's perfectly synced to the slide's duration/delay/easing — no
        // second timeline that could drift out of step with the first.
        const fromOpacity = inFlightOpacity ?? (prevWasActive === undefined ? (active ? 1 : 0.5) : (prevWasActive ? 1 : 0.5))
        const toOpacity = active ? 1 : 0.5
        // Extended on request for a gentler, softer, slower feel (was
        // 460-780ms base/cap, 0.4ms/px, 20ms/index stagger). |dy| here is the
        // VISUAL distance still to travel (incl. any in-flight offset folded
        // in above), so an interrupted card that's nearly home gets a
        // proportionally short remainder, not a full restart duration.
        const duration = Math.min(1100, 640 + Math.abs(dy) * 0.5)
        // A flat 140ms HOLD up front, before the per-card stagger — without
        // it, delay was 0-180ms driven only by stagger position, so the
        // first card (and often the toggled one) had ~0ms before motion
        // started: click and slide landed on the same frame, reading as an
        // instant cut into motion rather than a settled response. The hold
        // gives every card a genuine still beat at its current position
        // first, THEN the gentle glide into place — "click, pause, move,"
        // not "click, move."
        // KEEP IN SYNC with .doc-list-divider's animation-delay in popup.css
        // — the divider's entrance is choreographed to start exactly when the
        // cards' hold ends, so it fades in as the space clears rather than
        // while a held card still overlaps it.
        const REORDER_HOLD_MS = 140
        const delay = interrupted ? 0 : REORDER_HOLD_MS + Math.min(180, index * 25)
        // Jerk-at-start fix: `el` is the SAME .doc-item that also has a CSS
        // `transition: background 0.15s, box-shadow 0.15s` on :hover — and
        // the mouse is necessarily already hovering it (that's how the click
        // that triggered this happened), so that hover transition kicks off
        // on the exact same frame this animation starts. box-shadow forces a
        // main-thread repaint (unlike transform/opacity, which the compositor
        // handles on its own thread); competing for the same frame is what
        // reads as a stutter right at the start. `will-change` promotes this
        // element to its own compositor layer for the animation's duration,
        // isolating the slide from that concurrent repaint — removed again on
        // finish/cancel so cards aren't left promoted (and costing memory)
        // indefinitely.
        el.style.willChange = 'transform, opacity'
        const anim = el.animate(
          [
            { transform: `translateY(${dy}px)`, opacity: fromOpacity },
            { transform: 'translateY(0)', opacity: toOpacity },
          ],
          // fill: 'backwards' — NOT 'none'. This is the actual bug behind the
          // still-broken hold: a WAAPI animation's keyframes only apply during
          // its ACTIVE phase, not during `delay`. With 'none', the card had NO
          // transform/opacity override for the whole delay window — it sat at
          // its real, final, already-reflowed position from the instant React
          // re-rendered. Then when the active phase finally started, the FIRST
          // keyframe (the OLD position) snapped it backward for a frame before
          // sliding forward. So the actual sequence was click → jump to final
          // spot → hold → jump BACK to start → slide forward — worse than no
          // delay at all. 'backwards' makes the effect hold the first
          // keyframe's values for the entire delay, so the card genuinely
          // stays at its old position/opacity until the active phase begins.
          // No 'forwards' needed after — the CSS class already matches the
          // last keyframe once the animation ends, so that handoff was never
          // the problem.
          { duration, delay, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'backwards' }
        )
        // Guarded cleanup: cancel events fire ASYNC, so when an interruption
        // above cancels the OLD animation, that old listener runs after this
        // new animation is already registered and mid-flight — an unguarded
        // `willChange = ''` there would strip the layer promotion out from
        // under the new animation. Only the animation currently on record for
        // this card is allowed to clean up.
        const clearPromotion = () => {
          if (runningAnims.current.get(key) !== anim) return
          runningAnims.current.delete(key)
          el.style.willChange = ''
        }
        anim.addEventListener('finish', clearPromotion)
        anim.addEventListener('cancel', clearPromotion)
        runningAnims.current.set(key, anim)
      }
      prevTops.current.set(key, nextTop)
      prevActiveMap.current.set(key, active)
    })
  })

  function computeUncited(clips: HistoryEntry[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const c of clips) {
      if (c.destinationId && !c.cited) counts[c.destinationId] = (counts[c.destinationId] ?? 0) + 1
    }
    return counts
  }

  useEffect(() => {
    chrome.storage.sync.get(['docs', 'docId', 'notionConfig'], (result) => {
      let d: DocDestination[] = (result.docs as DocDestination[]) ?? []
      if (d.length === 0 && result.docId) d = [{ id: result.docId as string, name: 'My Notes', active: true }]
      d = d.map(doc => ({ ...doc, active: doc.active ?? true }))
      setDocs(d)

      const nc = result.notionConfig as NotionConfig | undefined
      if (nc) {
        setNotionToken(nc.token)
        setNotionPageId(nc.pageId)
        setNotionPageName(nc.pageName)
      }

      if (d.length > 0) syncDocNames(d)
    })

    // Per-doc clip stats + uncited-citation counts live in storage.local →
    // durable across drawer close/reopen and browser restarts. Read on mount,
    // then stay in sync so a clip (or a citation) made while the drawer is
    // open updates the counts live.
    chrome.storage.local.get(['docStats', 'clips', 'history', 'aiConfig'], (result) => {
      setDocStats((result.docStats as DocStats) ?? {})
      const clips = result.clips as HistoryEntry[] | undefined
      const list = clips && clips.length ? clips : ((result.history as HistoryEntry[]) ?? [])
      setUncitedCounts(computeUncited(list))
      setAllClips(list)
      setAiConnected(!!result.aiConfig)
    })

    const onStatsChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== 'local') return
      if (changes.docStats) setDocStats((changes.docStats.newValue as DocStats) ?? {})
      if (changes.clips) {
        const list = (changes.clips.newValue as HistoryEntry[]) ?? []
        setUncitedCounts(computeUncited(list))
        setAllClips(list)
      }
      if ('aiConfig' in changes) setAiConnected(!!changes.aiConfig.newValue)
    }
    chrome.storage.onChanged.addListener(onStatsChange)
    return () => chrome.storage.onChanged.removeListener(onStatsChange)
  }, [])

  async function handleSummarize(doc: DocDestination) {
    setSummaryOpenFor(doc.id)
    setSummaryText('')
    const docClips = allClips.filter((c) => c.destinationId === doc.id).map((c) => c.text)
    if (docClips.length === 0) {
      setSummaryStatus('No clips saved to this doc yet.')
      return
    }
    setSummaryStatus('Summarizing…')
    const msg: SummarizeTopicMessage = {
      type: 'SUMMARIZE_TOPIC',
      payload: { destinationId: doc.id, destinationName: doc.name, clips: docClips },
    }
    const res: SummarizeTopicResponse = await chrome.runtime.sendMessage(msg)
    if (res.success && res.summary) {
      setSummaryText(res.summary)
      setSummaryStatus('')
    } else {
      setSummaryStatus(res.error ?? 'Could not summarize')
    }
  }

  // Doc names always track the real Google Doc title (renaming inside
  // SnipKeep is intentionally not offered — see the newDocName comment
  // above). The mount effect above covers most of the ways that's kept
  // fresh: reopening the drawer (Drawer.tsx fully unmounts on close) and
  // switching away from/back to this tab (Popup.tsx renders DocsTab via a
  // ternary, so it unmounts too) both re-run it via a fresh mount. The one
  // gap: the drawer staying open on this exact tab, uninterrupted, while the
  // Doc gets renamed in a different browser tab. visibilitychange fires on
  // *this* page's own document when the user tabs away and back — even
  // though the drawer is a content-script overlay, it shares the host
  // page's document, so this fires exactly when it should.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && docsRef.current.length > 0) {
        syncDocNames(docsRef.current)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // Title lookups go through the background — content scripts (the drawer)
  // can't use chrome.identity, so a direct Docs API call here would fail.
  function getDocTitle(docId: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_DOC_TITLE', docId } satisfies GetDocTitleMessage,
        (res: GetDocTitleResponse) => {
          if (chrome.runtime.lastError) { resolve(null); return }
          resolve(res?.title ?? null)
        }
      )
    })
  }

  async function syncDocNames(currentDocs: DocDestination[]): Promise<void> {
    const synced = await Promise.all(
      currentDocs.map(async (doc) => {
        const title = await getDocTitle(doc.id)
        return title ? { ...doc, name: title } : doc
      })
    )

    const hasChanges = synced.some((doc, i) => doc.name !== currentDocs[i].name)
    if (!hasChanges) return
    setDocs(synced)
    chrome.storage.sync.set({ docs: synced })
  }

  function showFlash(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  function parseDocId(input: string): string {
    const match = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
    return match ? match[1] : input.trim()
  }

  function handleDocUrlChange(value: string) {
    setNewDocId(value)
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)

    const id = parseDocId(value.trim())
    if (id.length < 20) return

    fetchTimerRef.current = setTimeout(async () => {
      setIsFetchingTitle(true)
      const title = await getDocTitle(id)
      setIsFetchingTitle(false)
      if (title) setNewDocName(title)
    }, 600)
  }

  function handleAddDoc() {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    setIsFetchingTitle(false)

    const id = parseDocId(newDocId.trim())
    const name = newDocName.trim() || 'My Notes'

    if (!id) { showFlash('Could not parse a Doc ID from that URL.'); return }
    if (docs.find(d => d.id === id)) { showFlash('Already in your list.'); return }

    const updated = [...docs, { id, name, active: true }]
    setDocs(updated)
    setNewDocId('')
    setNewDocName('')
    setIsAdding(false)
    showFlash(`"${name}" added.`)

    chrome.storage.sync.set({ docs: updated }, () => {
      if (chrome.runtime.lastError) {
        setDocs(docs)
        showFlash(`Save failed: ${chrome.runtime.lastError.message}`)
      }
    })
  }

  function handleCancelAdd() {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    setIsFetchingTitle(false)
    setNewDocId('')
    setNewDocName('')
    setIsAdding(false)
  }

  function handleRemoveDoc(id: string) {
    const updated = docs.filter(d => d.id !== id)
    chrome.storage.sync.set({ docs: updated }, () => {
      if (chrome.runtime.lastError) { showFlash(`Failed to remove: ${chrome.runtime.lastError.message}`); return }
      setDocs(updated)
    })
  }

  function handleToggleDoc(id: string) {
    const updated = docs.map(d => d.id === id ? { ...d, active: !d.active } : d)
    setDocs(updated)
    chrome.storage.sync.set({ docs: updated })
  }

  // Assignment/Project Mode — "done" and "active" are deliberately independent:
  // marking a project done doesn't silently flip its toolbar visibility, and
  // reopening one doesn't silently restore it either. No hidden side effects.
  function markDone(id: string) {
    const updated = docs.map(d => d.id === id ? { ...d, done: true } : d)
    setDocs(updated)
    chrome.storage.sync.set({ docs: updated })
    // Marking done moves it out of this tab entirely (into Completed) — a
    // flash instead of an auto-switch, so the user isn't yanked to another
    // tab mid-task but still gets confirmation of where it went.
    showFlash('Marked as done — see the Completed tab.')
  }

  // Deadline-Aware Citations — a due date is purely local archive metadata on
  // the destination; it never touches the Doc itself. The
  // calendar commits immediately on click, so there's no separate draft/save
  // step — just "open the picker" and "apply what was picked."
  function selectDeadline(id: string, date: string) {
    const updated = docs.map(d => d.id === id ? { ...d, dueDate: date } : d)
    setDocs(updated)
    chrome.storage.sync.set({ docs: updated })
    setEditingDeadlineFor(null)
  }

  function clearDeadline(id: string) {
    const updated = docs.map(d => d.id === id ? { ...d, dueDate: undefined } : d)
    setDocs(updated)
    chrome.storage.sync.set({ docs: updated })
    setEditingDeadlineFor(null)
  }

  function handleSaveNotion() {
    const token = notionToken.trim()
    const pageId = notionPageId.trim()
    const pageName = notionPageName.trim() || 'Notion'
    if (!token || !pageId) { showFlash('Fill in token and page ID.'); return }
    const nc: NotionConfig = { token, pageId, pageName }
    chrome.storage.sync.set({ notionConfig: nc })
    showFlash('Notion connected.')
  }

  function handleDisconnectNotion() {
    chrome.storage.sync.remove('notionConfig')
    setNotionToken('')
    setNotionPageId('')
    setNotionPageName('')
    showFlash('Notion disconnected.')
  }

  // Suppress unused variable warnings for Notion (hidden at MVP)
  void handleSaveNotion
  void handleDisconnectNotion
  void notionToken
  void notionPageId
  void notionPageName

  // Active docs sort above inactive ones (usable destinations on top, dormant
  // ones sink) — a stable sort, so order within each group is preserved. The
  // FLIP effect above animates the card as it moves between groups on toggle.
  const activeDocs = docs.filter(d => !d.done).sort((a, b) => Number(b.active) - Number(a.active))
  // Index of the last active doc (-1 if none are active) — "Add document"
  // renders right after it, not at the true bottom of the whole list. Adding
  // a destination is an active-oriented action (a fresh doc is active by
  // default), so it belongs grouped with "the docs you're using," not
  // dangling after the "Hidden from toolbar" section — and it stays reachable
  // without scrolling past however many toggled-off docs have piled up.
  const lastActiveIdx = activeDocs.reduce((acc, d, idx) => d.active ? idx : acc, -1)

  // Shared between its two render sites: normally right after the last active
  // card, but if literally no doc is active, there's no "after the active
  // group" position to hook onto, so it falls back to rendering above the
  // (all-inactive) list instead of disappearing.
  // Opening the form is an INSERTION of ~200px of content mid-list. A
  // conditionally-mounted form can never animate open (CSS transitions need a
  // "before" state on the same element), so the old ternary — button OR form
  // — made the form pop in at full height on one frame while everything below
  // (the "Hidden from toolbar" divider, the inactive cards) teleported down.
  // Instead, BOTH variants stay mounted inside one wrapper, each in a
  // reciprocal 0fr↔1fr grid collapse (same trick as History's action row):
  // the button shrinks as the form grows on the same clock/curve, and the
  // divider + cards below simply ride the single smooth layout change — no
  // FLIP needed for them, and Cancel animates closed for free. The wrapper is
  // also the (now never-remounting-on-open) FLIP participant for toggles.
  const addFormOpen = isAdding || docs.length === 0
  const addControl = (
    <div className="add-control" ref={(el) => { addControlEl.current = el }}>
      <div className={`add-collapse${addFormOpen ? '' : ' open'}`}>
        <div className="add-collapse-inner">
          <button className="btn-add-trigger" onClick={() => setIsAdding(true)}>
            <MdAdd size={16} className="btn-add-icon" />
            Add document
          </button>
        </div>
      </div>
      <div className={`add-collapse${addFormOpen ? ' open' : ''}`}>
        <div className="add-collapse-inner">
          <div className="add-form">
            <div className="input-group">
              <div className="field">
                <span className="field-label">Google Doc URL</span>
                <div className="field-input-row">
                  <MdLink size={14} className="field-input-icon" />
                  <input
                    ref={addInputRef}
                    className="field-input"
                    value={newDocId}
                    onChange={e => handleDocUrlChange(e.target.value)}
                    placeholder="Paste URL or Doc ID"
                    spellCheck={false}
                  />
                </div>
              </div>

            </div>

            {/* Read-only by design — not a truncated feature. The Doc's name always
                tracks its real Google Doc title; syncDocNames() re-fetches and
                overwrites it on every drawer mount regardless, so a custom name
                typed here would silently revert the next time the drawer opened.
                Showing it as a plain status line (not a field with an edit
                affordance) makes that truthful up front instead of implying an
                editability that wouldn't actually stick. */}
            {newDocId.trim() && (
              <p className="doc-name-status">
                {isFetchingTitle ? (
                  <><span className="field-spinner" /> Fetching the document's title…</>
                ) : (
                  <><MdCheckCircle size={13} className="doc-name-status-icon" /> Will be added as "{newDocName || 'My Notes'}"</>
                )}
              </p>
            )}

            <p className="hint">Paste the full URL from your browser — the ID is extracted automatically.</p>

            <div className="add-actions">
              {docs.length > 0 && (
                <button className="btn-ghost" onClick={handleCancelAdd}>Cancel</button>
              )}
              <button className="btn-primary add-submit" onClick={handleAddDoc} disabled={!newDocId.trim()}>
                Add Document
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // Render-time mirror of the FLIP effect's initial-population guard: the
  // divider's entrance is a CSS MOUNT animation, and CSS can't know WHY the
  // element mounted — a toggle crossing the boundary (animate) vs. the docs
  // simply arriving from storage on drawer open (don't — same ghost-motion
  // bug the add control had, via a different mechanism). If the cards being
  // rendered have no position history yet, this render is data arriving, so
  // the divider mounts without its `entering` class and appears in place.
  // Reading prevTops during render is safe here — it's only ever written in
  // the layout effect, after render.
  const dividerMayAnimate = activeDocs.some(d => prevTops.current.has(d.id))

  return (
    <div className="tab-content">
      {/* The tab label "Docs" already names this — no redundant section header */}
      <div className="section">
        {activeDocs.length > 0 && (
          <div className="doc-list">
            {activeDocs.map((doc, i) => {
              const uncited = uncitedCounts[doc.id] ?? 0
              const isEditingDeadline = editingDeadlineFor === doc.id
              const status = doc.dueDate && !isEditingDeadline ? deadlineStatus(doc.dueDate, uncited) : null
              // Sort already groups active-above-inactive, but a sort alone is
              // invisible — nothing signals WHY cards start dimming partway
              // down. A label + rule at the exact transition point turns an
              // implicit grouping into a perceptible one (Gestalt common
              // region), and names the toggle's own effect ("Hide from
              // toolbar" tooltip → "Hidden from toolbar" label) rather than
              // inventing new vocabulary for the same concept.
              const showInactiveDivider = i > 0 && activeDocs[i - 1].active && !doc.active
              return (
                <React.Fragment key={doc.id}>
                  {i === 0 && lastActiveIdx === -1 && addControl}
                  {showInactiveDivider && (
                    <div className={`doc-list-divider${dividerMayAnimate ? ' entering' : ''}`}>
                      <span className="doc-list-divider-label">Hidden from toolbar</span>
                    </div>
                  )}
                  <div
                    ref={(el) => { if (el) cardEls.current.set(doc.id, el); else cardEls.current.delete(doc.id) }}
                    className={`doc-item${doc.active ? '' : ' inactive'}${(menuOpenFor === doc.id || isEditingDeadline) ? ' popover-active' : ''}`}
                  >
                  <div className="doc-item-top">
                    <div className="doc-info">
                      <div className="doc-name">{doc.name}</div>
                      <div className="doc-meta">{formatDocMeta(docStats[doc.id])}</div>
                    </div>
                    <button
                      className={`btn-toggle${doc.active ? ' on' : ' off'}`}
                      onClick={() => handleToggleDoc(doc.id)}
                      title={doc.active ? 'Hide from toolbar' : 'Show in toolbar'}
                    />
                    <div className="card-menu-wrap">
                      <button
                        className="card-menu-btn"
                        onClick={() => setMenuOpenFor(v => v === doc.id ? null : doc.id)}
                        title="More"
                      >
                        <MdMoreHoriz size={16} />
                      </button>
                      {menuOpenFor === doc.id && (
                        <DocMenu
                          docName={doc.name}
                          onSetDeadline={doc.dueDate ? undefined : () => { setEditingDeadlineFor(doc.id); setMenuOpenFor(null) }}
                          onMarkDone={() => { markDone(doc.id); setMenuOpenFor(null) }}
                          onRemove={() => { handleRemoveDoc(doc.id); setMenuOpenFor(null) }}
                          onSummarize={aiConnected ? () => { handleSummarize(doc); setMenuOpenFor(null) } : undefined}
                          onStudy={allClips.some(c => c.destinationId === doc.id && c.retrievalQuestion)
                            ? () => { openStudy(doc.id); setMenuOpenFor(null) }
                            : undefined}
                          onClose={() => setMenuOpenFor(null)}
                        />
                      )}
                    </div>
                  </div>

                  {(isEditingDeadline || status) && (
                    <div className="deadline-row">
                      {isEditingDeadline ? (
                        <DeadlineCalendar
                          value={doc.dueDate ?? ''}
                          onSelect={(date) => selectDeadline(doc.id, date)}
                          onClear={() => clearDeadline(doc.id)}
                          onClose={() => setEditingDeadlineFor(null)}
                        />
                      ) : (
                        <button
                          className={`deadline-status ${status!.tier}`}
                          onClick={() => setEditingDeadlineFor(doc.id)}
                          title="Click to change or remove the deadline"
                        >
                          <span className="deadline-status-text">
                            <span className="severity-dot" />
                            {status!.label}
                          </span>
                          {status!.tier === 'danger' && uncited > 0 && (
                            <span
                              className="cite-jump"
                              onClick={(e) => { e.stopPropagation(); onJumpToHistory(doc.name) }}
                            >
                              Cite them →
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {summaryOpenFor === doc.id && (
                    <div className="ai-summary-box">
                      <div className="ai-summary-head">
                        <span className="ai-summary-label"><MdAutoAwesome size={13} /> Summary</span>
                        <button className="ai-summary-close" onClick={() => setSummaryOpenFor(null)} title="Close">
                          <MdClose size={14} />
                        </button>
                      </div>
                      {summaryStatus && <p className="ai-summary-status">{summaryStatus}</p>}
                      {summaryText && <p className="ai-summary-text">{summaryText}</p>}
                    </div>
                  )}
                  </div>
                  {i === lastActiveIdx && addControl}
                </React.Fragment>
              )
            })}
          </div>
        )}

        {docs.length === 0 && !isAdding && (
          <p className="hint">Add a Google Doc to start clipping into it.</p>
        )}

        {flash && <div className="flash">{flash}</div>}

        {/* Fallback for when the list itself doesn't render at all — either
            genuinely zero docs, or every doc is marked done/completed — since
            in either case the in-list insertion points above never fire. */}
        {activeDocs.length === 0 && addControl}
      </div>

      {/* Notion — hidden until ready */}
    </div>
  )
}

// ── Completed Tab ─────────────────────────────────────────────────────────────
// A dedicated tab for finished projects (Assignment/Project Mode), separate
// from DocsTab's active list. Loads its own copy of `docs`/`docStats` — it's
// a sibling of DocsTab, not a child, so it can't reach into DocsTab's state.

function CompletedTab() {
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [docStats, setDocStats] = useState<DocStats>({})
  const [flash, setFlash] = useState('')

  useEffect(() => {
    chrome.storage.sync.get(['docs'], (result) => {
      setDocs((result.docs as DocDestination[]) ?? [])
    })
    chrome.storage.local.get(['docStats'], (result) => {
      setDocStats((result.docStats as DocStats) ?? {})
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.docs) setDocs((changes.docs.newValue as DocDestination[]) ?? [])
      if (changes.docStats) setDocStats((changes.docStats.newValue as DocStats) ?? {})
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  function showFlash(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  function handleReopen(id: string) {
    const updated = docs.map(d => d.id === id ? { ...d, done: false } : d)
    setDocs(updated)
    chrome.storage.sync.set({ docs: updated })
    showFlash('Reopened — see the Docs tab.')
  }

  function handleRemove(id: string) {
    const updated = docs.filter(d => d.id !== id)
    chrome.storage.sync.set({ docs: updated }, () => {
      if (chrome.runtime.lastError) { showFlash(`Failed to remove: ${chrome.runtime.lastError.message}`); return }
      setDocs(updated)
    })
  }

  const completedDocs = docs.filter(d => d.done)

  if (completedDocs.length === 0) {
    return (
      <div className="tab-content empty-state">
        <div className="empty-icon"><MdCheckCircle /></div>
        <div className="empty-text">No completed projects yet</div>
        <div className="empty-sub">Mark a doc as done from the Docs tab once you're finished with it.</div>
      </div>
    )
  }

  return (
    <div className="tab-content">
      <div className="section">
        <div className="doc-list">
          {completedDocs.map(doc => (
            <div key={doc.id} className="doc-item done">
              <div className="doc-item-top">
                <div className="doc-info">
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-meta">{formatDocMeta(docStats[doc.id])}</div>
                </div>
                <button className="btn-reopen" onClick={() => handleReopen(doc.id)}><MdUndo size={13} /> Reopen</button>
                <button className="btn-remove" onClick={() => handleRemove(doc.id)} title="Remove"><MdClose size={14} /></button>
              </div>
            </div>
          ))}
        </div>

        {flash && <div className="flash">{flash}</div>}
      </div>
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

// A Text Fragment (#:~:text=…) makes the browser scroll to and highlight the clip
// on the source page. The start,end range form is far more forgiving than matching
// the whole (normalized) string verbatim.
function buildTextFragment(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const words = clean.split(' ')
  const enc = (s: string) => encodeURIComponent(s)
  if (words.length <= 10) return `text=${enc(clean)}`
  const start = words.slice(0, 6).join(' ')
  const end = words.slice(-6).join(' ')
  return `text=${enc(start)},${enc(end)}`  // literal comma separates start/end
}

function sourceHref(entry: HistoryEntry): string {
  const base = entry.sourceUrl
  if (entry.kind === 'image') return base   // nothing to highlight for an image
  // Lecture-timestamp clip: the moment IS the deep link — reopen the video
  // already playing there. A text fragment is useless on a video page (the
  // transcript panel is collapsed by default, so there's nothing to match).
  if (entry.videoTime !== undefined) return timedVideoUrl(base, entry.videoTime)
  const frag = buildTextFragment(entry.text)
  if (!frag) return base
  // The text directive must be the last part of the fragment, after ":~:".
  return base + (base.includes('#') ? ':~:' : '#:~:') + frag
}

function docHref(entry: HistoryEntry): string | null {
  const id = entry.destinationId
  if (!id || id === 'notion') return null   // Google Doc deep-link only (Notion hidden at MVP)
  return `https://docs.google.com/document/d/${id}/edit`
}

// ── Citations ─────────────────────────────────────────────────────────────────

type CitationStyle = 'apa' | 'mla' | 'bibtex'

// Best-effort "site name" from the URL: the registrable domain's main label,
// capitalized. make.com → Make, docs.google.com → Google, en.wikipedia.org → Wikipedia.
function siteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const parts = host.split('.')
    const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : host
  } catch {
    return ''
  }
}

// Build a citation from the metadata a clip already carries. No author is
// captured, so the site name stands in as the (group) author and the save time
// is used as the retrieval / accessed date.
function formatCitation(entry: HistoryEntry, style: CitationStyle): string {
  const url = entry.sourceUrl
  const title = (entry.sourceTitle || 'Untitled').trim()
  const site = siteName(url) || 'n.p.'
  const d = new Date(entry.savedAt)
  const year = d.getFullYear()
  const monthLong = d.toLocaleDateString('en-US', { month: 'long' })
  const longDate = `${monthLong} ${d.getDate()}, ${year}`   // July 5, 2026
  const mlaDate = `${d.getDate()} ${monthLong} ${year}`     // 5 July 2026

  switch (style) {
    case 'apa':
      return `${site}. (${year}). ${title}. Retrieved ${longDate}, from ${url}`
    case 'mla':
      return `"${title}." ${site}, ${url}. Accessed ${mlaDate}.`
    case 'bibtex': {
      const key = `${site.toLowerCase().replace(/[^a-z0-9]/g, '')}${year}`
      return [
        `@misc{${key},`,
        `  author = {{${site}}},`,
        `  title  = {{${title}}},`,
        `  year   = {${year}},`,
        `  url    = {${url}},`,
        `  note   = {Accessed ${mlaDate}}`,
        `}`,
      ].join('\n')
    }
  }
}

// Works Cited list (docs/IDEAS.md #2): one entry per SOURCE PAGE, not per
// clip — several clips can share a sourceUrl, and the bibliography shouldn't
// list the same source twice. Alphabetized by the formatted citation text,
// which starts with the site name — the de facto "author" formatCitation
// substitutes in, so this sorts the same way a real bibliography would.
function buildWorksCited(clips: HistoryEntry[], destinationId: string, style: CitationStyle): string[] {
  const seen = new Set<string>()
  const citations: string[] = []
  for (const c of clips) {
    if (c.destinationId !== destinationId || !c.cited) continue
    if (seen.has(c.sourceUrl)) continue
    seen.add(c.sourceUrl)
    citations.push(formatCitation(c, style))
  }
  return citations.sort((a, b) => a.localeCompare(b))
}

// Copy a string to the clipboard from the content-script context. The textarea +
// execCommand path goes FIRST on purpose: navigator.clipboard.writeText rejects
// (or no-ops) whenever the page owns document focus — which it ALWAYS does on top
// of Google Docs — silently leaving the previous clipboard in place. The textarea
// takes focus itself, so it copies regardless of who had focus.
function copyViaTextarea(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try { ta.setSelectionRange(0, text.length) } catch { /* ignore */ }
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (copyViaTextarea(text)) return true
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // both paths failed
  }
  return false
}

const CITE_STYLES: { id: CitationStyle; label: string }[] = [
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'bibtex', label: 'BibTeX' },
]

const DAY_MS = 86_400_000

// Deadline-Aware Citations — ties the already-shipped citation feature to a
// real, concrete deadline instead of an abstract virtue. Escalates through
// three tiers so the same status line reads as informative early on and
// urgent only once it's actually urgent.
type DeadlineTier = 'calm' | 'warn' | 'danger'

function deadlineStatus(dueDate: string, uncited: number): { tier: DeadlineTier; label: string } {
  // End-of-day on the due date, so "due today" doesn't read as overdue at 9am.
  const due = new Date(`${dueDate}T23:59:59`).getTime()
  const daysLeft = Math.ceil((due - Date.now()) / DAY_MS)
  const uncitedLabel = `${uncited} uncited`

  if (daysLeft < 0) return { tier: 'danger', label: `Overdue by ${-daysLeft}d · ${uncitedLabel}` }
  if (daysLeft === 0) return { tier: 'danger', label: `Due today · ${uncitedLabel}` }
  if (daysLeft <= 2) return { tier: 'danger', label: `Due in ${daysLeft}d · ${uncitedLabel}` }
  if (daysLeft <= 7) return { tier: 'warn', label: `Due in ${daysLeft}d · ${uncitedLabel}` }
  return { tier: 'calm', label: `Due in ${daysLeft}d · ${uncitedLabel}` }
}

// Local-calendar-day formatting — deliberately NOT toISOString(), which reads
// UTC and can silently shift the date by a day depending on the user's
// timezone. dueDate is compared against local "today" everywhere else
// (deadlineStatus above), so the picker must produce the same local day.
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getMonthGrid(year: number, month: number): (Date | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay()  // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = new Array(firstWeekday).fill(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day))
  return cells
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// A small "···" menu consolidating the two less-frequent doc-card actions
// (Mark as done, Remove) so the card's button row stays down to just the
// toggle switch + one trigger — same dismiss-on-outside-click pattern as
// DeadlineCalendar and the Drawer's avatar menu.
function DocMenu({
  docName,
  onSetDeadline,
  onMarkDone,
  onRemove,
  onSummarize,
  onStudy,
  onClose,
}: {
  docName: string
  // Undefined when a deadline already exists — editing then happens via the
  // always-visible countdown pill, not this menu (the pill IS the point of
  // the feature; it stays on the card, only the initial "add one" prompt
  // moves in here).
  onSetDeadline?: () => void
  onMarkDone: () => void
  onRemove: () => void
  // Undefined entirely (not just disabled) when no AI key is connected —
  // an inert menu item invites a dead click and needs its own explanation;
  // omitting it keeps the feature genuinely invisible until opted in.
  onSummarize?: () => void
  // Undefined until this doc has at least one clip with a retrieval
  // question — same invisible-until-real rule as onSummarize.
  onStudy?: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Remove is the one action here that isn't trivially reversible (it drops
  // the doc's deadline metadata, and it's easy to misread as "delete my
  // Google Doc" — it isn't). An inline confirm swap, not a separate modal —
  // SnipKeep's drawer is deliberately non-modal (`modal={false}`) everywhere
  // else, so a blocking overlay here would be the one inconsistent surface.
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.composedPath()[0] as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  if (confirming) {
    return (
      <div className="card-menu card-menu-confirm" ref={menuRef}>
        {/* Two visual tiers, not one run-on sentence: the question (what's
            happening) reads first and bold; the reassurance (the one thing
            someone actually worries about) gets its own line so it can't get
            lost mid-sentence — chunking per Miller's Law, not just wrapping. */}
        <p className="card-menu-confirm-title">Remove <strong>{docName}</strong>?</p>
        <p className="card-menu-confirm-text">Your Doc and its clips stay safe — this only stops saving here.</p>
        <div className="card-menu-confirm-actions">
          <button className="card-menu-cancel" onClick={() => setConfirming(false)}>Cancel</button>
          <button className="card-menu-confirm-remove" onClick={onRemove}>Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card-menu" ref={menuRef}>
      {onSetDeadline && (
        <button className="card-menu-item" onClick={onSetDeadline}>
          <span className="card-menu-icon"><MdEvent /></span>Set a deadline
        </button>
      )}
      {onStudy && (
        <button className="card-menu-item" onClick={onStudy}>
          <span className="card-menu-icon"><MdLightbulb /></span>Study
        </button>
      )}
      {onSummarize && (
        <button className="card-menu-item" onClick={onSummarize}>
          <span className="card-menu-icon"><MdAutoAwesome /></span>Summarize
        </button>
      )}
      <button className="card-menu-item" onClick={onMarkDone}>
        <span className="card-menu-icon"><MdCheck /></span>Mark as done
      </button>
      {/* A divider ahead of the one destructive item, not just another row in
          the list — the same "give it distance" convention as macOS/VS Code
          context menus, so a quick click right after Mark as done doesn't
          land on Remove by muscle memory. */}
      <div className="card-menu-divider" />
      <button className="card-menu-item danger" onClick={() => setConfirming(true)}>
        <span className="card-menu-icon"><MdClose /></span>Remove
      </button>
    </div>
  )
}

// History card actions split the same way as the Doc card: Source/Doc/Cite
// are frequent "do something with this content" actions and stay visible;
// Archived/Add-a-note are occasional or fallback actions (you don't annotate
// a clip on every visit — the Reflection Nudge already exists to prompt notes
// at the right moment, this menu doesn't need to) and move behind "···",
// reusing the same .card-menu styling for consistency.
function HistoryCardMenu({
  archiveUrl,
  onAddNote,
  onRemove,
  onAskFollowUp,
  onStudyDoc,
  onToggleConfusion,
  confused,
  onClose,
}: {
  archiveUrl?: string
  onAddNote?: () => void
  onRemove: () => void
  // Undefined entirely (not disabled) when no AI key is connected — see the
  // matching note on DocMenu's onSummarize.
  onAskFollowUp?: () => void
  // Undefined when this clip has no retrieval question (nothing to study yet).
  onStudyDoc?: () => void
  // Confusion Flag toggle — AI-gated (the ladder needs a key). Label flips
  // with state: "I don't get this yet" ⇄ "Got it now".
  onToggleConfusion?: () => void
  confused?: boolean
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.composedPath()[0] as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  return (
    <div className="card-menu" ref={menuRef}>
      {archiveUrl && (
        <a
          className="card-menu-item"
          href={archiveUrl}
          target="_blank"
          rel="noreferrer"
          title="Open a permanent snapshot — works even if the live page is gone"
        >
          <span className="card-menu-icon"><MdArchive /></span>Archived
        </a>
      )}
      {onAddNote && (
        <button className="card-menu-item" onClick={onAddNote}>
          <span className="card-menu-icon"><MdEdit /></span>Add a note
        </button>
      )}
      {onAskFollowUp && (
        <button className="card-menu-item" onClick={onAskFollowUp}>
          <span className="card-menu-icon"><MdAutoAwesome /></span>Follow-up questions
        </button>
      )}
      {onStudyDoc && (
        <button className="card-menu-item" onClick={onStudyDoc}>
          <span className="card-menu-icon"><MdLightbulb /></span>Study this doc
        </button>
      )}
      {onToggleConfusion && (
        <button className="card-menu-item" onClick={onToggleConfusion}>
          <span className="card-menu-icon"><MdHelpOutline /></span>
          {confused ? 'Got it now' : "I don't get this yet"}
        </button>
      )}
      {/* Destructive, so divider-separated (distance from the safe actions) and
          labelled "history" — it only drops SnipKeep's local record; the Doc
          keeps the text. Undo (below) is the safety net, so no blocking dialog. */}
      <div className="card-menu-divider" />
      <button
        className="card-menu-item danger"
        onClick={onRemove}
        title="Remove from SnipKeep — your Google Doc keeps the text"
      >
        <span className="card-menu-icon"><MdDeleteOutline /></span>Remove from history
      </button>
    </div>
  )
}

// Citation style is picked here, at the moment of citing — not from a persistent
// "Cite as APA/MLA/BibTeX" strip up top (removed: that strip put academic jargon
// in prime real estate for the ~majority of users who never cite). The last
// style picked is remembered (marked with a check), so a repeat citer's usual
// format is the obvious one-tap choice, and non-citers never see the jargon.
function CiteMenu({
  current,
  onPick,
  onClose,
}: {
  current: CitationStyle
  onPick: (style: CitationStyle) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.composedPath()[0] as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  return (
    <div className="card-menu cite-menu" ref={menuRef}>
      {CITE_STYLES.map(s => (
        <button key={s.id} className="card-menu-item" onClick={() => onPick(s.id)}>
          <span className="card-menu-icon">{current === s.id ? <MdCheck /> : null}</span>
          Copy as {s.label}
        </button>
      ))}
    </div>
  )
}

// Filter History by which document a clip was saved to — recognition (shows the
// list of docs) rather than recall (typing a name into search), and it matches
// by exact destinationId, not a name substring. Only rendered when there is
// more than one document to choose between (otherwise it can't filter anything).
interface DocOption {
  id: string
  name: string
  count: number
}

function FilterMenu({
  options,
  current,
  onPick,
  onClose,
}: {
  options: DocOption[]
  current: string | null
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.composedPath()[0] as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  return (
    <div className="card-menu filter-menu" ref={menuRef}>
      <button className="card-menu-item" onClick={() => onPick(null)}>
        <span className="card-menu-icon">{current === null ? <MdCheck /> : null}</span>
        All documents
      </button>
      <div className="card-menu-divider" />
      {options.map(o => (
        <button key={o.id} className="card-menu-item" onClick={() => onPick(o.id)}>
          <span className="card-menu-icon">{current === o.id ? <MdCheck /> : null}</span>
          <span className="filter-menu-name">{o.name}</span>
          <span className="filter-menu-count">{o.count}</span>
        </button>
      ))}
    </div>
  )
}

// A small custom calendar, styled to match SnipKeep's own dark theme — the
// native <input type="date"> picker is OS-rendered and can't be themed at
// all, so it would clash with everything else in the drawer. Commits
// immediately on click (no separate "Set" step); dismisses on an outside
// click, same pattern as the avatar and destination-menu dropdowns elsewhere.
function DeadlineCalendar({
  value,
  onSelect,
  onClear,
  onClose,
}: {
  value: string
  onSelect: (date: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const initial = value ? new Date(`${value}T00:00:00`) : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.composedPath()[0] as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  function prevMonth() {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }
  function nextMonth() {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const todayIso = toISODate(new Date())
  const cells = getMonthGrid(viewYear, viewMonth)
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="cal-popup" ref={popRef}>
      <div className="cal-header">
        <button className="cal-nav" onClick={prevMonth} title="Previous month">‹</button>
        <span className="cal-month">{monthLabel}</span>
        <button className="cal-nav" onClick={nextMonth} title="Next month">›</button>
      </div>
      <div className="cal-weekdays">
        {WEEKDAY_LABELS.map(w => <span key={w}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="cal-cell empty" />
          const iso = toISODate(d)
          return (
            <button
              key={i}
              className={`cal-cell${iso === value ? ' selected' : ''}${iso === todayIso ? ' today' : ''}`}
              disabled={iso < todayIso}
              onClick={() => onSelect(iso)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      {value && (
        <div className="cal-footer">
          <button className="cal-clear" onClick={onClear}>Remove deadline</button>
        </div>
      )}
    </div>
  )
}

// Deterministically pick one clip to "resurface" per day, preferring clips older
// than a day so it feels like revisiting, not re-reading what you just saved.
function pickResurfaced(clips: HistoryEntry[]): HistoryEntry | null {
  if (clips.length < 3) return null
  const now = Date.now()
  const eligible = clips.filter(c => now - c.savedAt > DAY_MS)
  const finalPool = eligible.length ? eligible : clips
  const daySeed = Math.floor(now / DAY_MS)
  return finalPool[daySeed % finalPool.length]
}

// Gentle Reflection Nudge — targets the collector's fallacy (saving feels like
// learning; it isn't) at the exact moment it's happening, without shame. Walks
// the newest-first archive from the front, counting a streak of consecutive
// clips from the SAME page that have no margin note — the classic "reading one
// article, highlighting quote after quote, never once writing a reaction" case.
const REFLECTION_NUDGE_THRESHOLD = 5

function pickReflectionNudge(clips: HistoryEntry[]): { url: string; title: string; count: number } | null {
  if (clips.length === 0) return null
  const url = clips[0].sourceUrl
  const title = clips[0].sourceTitle
  let count = 0
  for (const c of clips) {
    if (c.sourceUrl !== url || c.note) break
    count++
  }
  return count >= REFLECTION_NUDGE_THRESHOLD ? { url, title, count } : null
}

const MAX_VISIBLE = 50

// Render a margin note, turning #tags into clickable chips that filter the archive.
function renderNoteWithTags(note: string, onTag: (tag: string) => void): React.ReactNode[] {
  return note.split(/(#[\w-]+)/g).map((part, i) =>
    /^#[\w-]+$/.test(part)
      ? <button key={i} className="note-tag" onClick={() => onTag(part)}>{part}</button>
      : <span key={i}>{part}</span>
  )
}

function History({ initialFilter, onFilterConsumed }: { initialFilter: string | null; onFilterConsumed: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [citeStyle, setCiteStyle] = useState<CitationStyle>('apa')
  // `label` overrides the default Copied/Copy failed text — used for the
  // Works Cited write-back below, which resolves later than the clipboard
  // copy (a network round-trip vs. an instant local op), so it reuses this
  // same flash slot rather than adding a second one.
  const [feedback, setFeedback] = useState<{ key: string; ok: boolean; label?: string } | null>(null)
  // Removal (single or bulk) stages a snapshot so the undo bar can restore it.
  const [undo, setUndo] = useState<{ snapshot: HistoryEntry[]; label: string } | null>(null)
  const undoTimer = useRef<number | null>(null)
  // The bottom "Clear" control swaps to an inline "are you sure?" when armed.
  const [clearConfirming, setClearConfirming] = useState(false)
  const [query, setQuery] = useState('')
  // Retrieval Flip: cards whose clip text has been revealed this session
  // (keyed by the card's render key). Deliberately NOT persisted — next
  // popup open, the question leads again and earns another recall attempt.
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  // Page url → Wayback Machine snapshot url. Populated by the background's
  // link-rot insurance a few seconds after a save; listened for live so the
  // "🏛 Archived" link can appear without reopening the drawer.
  const [archivedUrls, setArchivedUrls] = useState<Record<string, string>>({})
  // Filter History to a single destination doc (by id), or null for all.
  const [docFilter, setDocFilter] = useState<string | null>(null)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  // Reflection Nudge: remembers the last {url, count} streak that was
  // dismissed, so it only reappears if the SAME article's note-less streak
  // grows further — not every time the drawer reopens unchanged.
  const [reflectionDismissed, setReflectionDismissed] = useState<{ url: string; count: number } | null>(null)
  // Assignment/Project Mode: destinations marked done are excluded from the
  // proactive pickers (Resurfaced/Reflection) — a finished project shouldn't
  // keep getting surfaced for delight or reflection. The main searchable
  // list is untouched; you can still find and cite old work.
  const [doneDestIds, setDoneDestIds] = useState<Set<string>>(new Set())
  // Whether a bring-your-own AI key is connected — gates the "✨ Follow-up
  // questions" menu item; invisible entirely until one exists, per
  // docs/IDEAS.md #3.
  const [aiConnected, setAiConnected] = useState(false)
  const [followUpOpenFor, setFollowUpOpenFor] = useState<number | null>(null)
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([])
  const [followUpStatus, setFollowUpStatus] = useState('')

  useEffect(() => {
    chrome.storage.local.get(
      ['clips', 'history', 'archivedUrls', 'reflectionNudgeDismissed', 'aiConfig'],
      (result) => {
        const clips = result.clips as HistoryEntry[] | undefined
        // Fall back to the legacy recent-10 store until the archive is seeded.
        setEntries(clips && clips.length ? clips : ((result.history as HistoryEntry[]) ?? []))
        setArchivedUrls((result.archivedUrls as Record<string, string>) ?? {})
        setReflectionDismissed((result.reflectionNudgeDismissed as { url: string; count: number } | undefined) ?? null)
        setAiConnected(!!result.aiConfig)
      }
    )
    chrome.storage.sync.get(['citationStyle', 'docs'], (result) => {
      const s = result.citationStyle as CitationStyle | undefined
      if (s === 'apa' || s === 'mla' || s === 'bibtex') setCiteStyle(s)
      const docs = (result.docs as DocDestination[] | undefined) ?? []
      setDoneDestIds(new Set(docs.filter(d => d.done).map(d => d.id)))
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('archivedUrls' in changes) {
        setArchivedUrls((changes.archivedUrls.newValue as Record<string, string>) ?? {})
      }
      if ('docs' in changes) {
        const docs = (changes.docs.newValue as DocDestination[] | undefined) ?? []
        setDoneDestIds(new Set(docs.filter(d => d.done).map(d => d.id)))
      }
      if ('aiConfig' in changes) setAiConnected(!!changes.aiConfig.newValue)
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  // Don't leave the undo timeout running after the tab unmounts.
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])

  // "Cite them →" (Deadline-Aware Citations, in DocsTab) lands here by setting
  // this from the parent — drop it into the search box, then clear it in the
  // parent so navigating away and back doesn't reapply a stale filter.
  useEffect(() => {
    if (initialFilter) {
      setQuery(initialFilter)
      onFilterConsumed()
    }
    // Intentionally reacts to initialFilter only, not onFilterConsumed —
    // this only needs to run when the incoming filter itself changes.
  }, [initialFilter])

  async function handleCite(entry: HistoryEntry, key: string, style: CitationStyle) {
    // The always-on "Cite as" strip is gone; the last style used IS the
    // remembered preference now, so persist whichever one was just picked.
    if (style !== citeStyle) {
      setCiteStyle(style)
      chrome.storage.sync.set({ citationStyle: style })
    }
    const ok = await copyToClipboard(formatCitation(entry, style))
    setFeedback({ key, ok })
    setTimeout(() => setFeedback(prev => (prev?.key === key ? null : prev)), 1400)
    if (!ok) return

    const result = await chrome.storage.local.get(['clips'])
    const clips = (result.clips as HistoryEntry[]) ?? []

    // Marks the clip as cited so DocsTab's uncited count (Deadline-Aware
    // Citations) drops, and the button switches to "✓ Cited" below. A one-way
    // ratchet — re-citing in a different style (below) doesn't touch this;
    // it stays cited, it just doesn't get re-marked.
    if (!entry.cited) {
      setEntries(prev => prev.map(e => e.savedAt === entry.savedAt ? { ...e, cited: true } : e))
      const idx = clips.findIndex(c => c.savedAt === entry.savedAt)
      if (idx !== -1) {
        clips[idx] = { ...clips[idx], cited: true }
        await chrome.storage.local.set({ clips })
      }
    }

    // Works Cited write-back (docs/IDEAS.md #2) — Google Docs only, same
    // boundary as Living Resurface/archive-link (Notion hidden at MVP).
    //
    // Runs on EVERY successful cite, not just the first — re-citing an
    // already-cited clip in a different style needs to update the Doc too,
    // not just the clipboard. And since this rebuilds the WHOLE list using
    // the style just picked (not each entry's own historical style), the
    // section always ends up in one consistent style after any cite click,
    // rather than a mix of whatever style happened to be active per entry.
    //
    // Silent on success (the "Copied ✓" flash already confirmed the primary
    // action — a second confirmation would be noise), but NOT silent on
    // failure: reuses the same flash slot to say so, since a silently failed
    // Doc write is the one outcome a user can't otherwise tell happened
    // without opening the Doc and checking. Resolves later than the
    // clipboard copy (network round-trip vs. instant local op), so this
    // flash can appear a beat after the first one already cleared.
    if (entry.destinationId && entry.destinationId !== 'notion') {
      const citations = buildWorksCited(clips, entry.destinationId, style)
      const msg: UpdateBibliographyMessage = {
        type: 'UPDATE_BIBLIOGRAPHY',
        payload: { destinationId: entry.destinationId, citations },
      }
      chrome.runtime.sendMessage(msg)
        .then((res: UpdateBibliographyResponse) => {
          if (res?.success) return
          setFeedback({ key, ok: false, label: 'Doc update failed' })
          setTimeout(() => setFeedback(prev => (prev?.key === key ? null : prev)), 2000)
        })
        .catch(() => {
          setFeedback({ key, ok: false, label: 'Doc update failed' })
          setTimeout(() => setFeedback(prev => (prev?.key === key ? null : prev)), 2000)
        })
    }
  }

  // Single source for writing the archive: state + storage together. When the
  // archive goes empty we also drop the legacy `history` seed, or the loader
  // (clips.length ? clips : history) would resurrect the old last-10 on remount.
  function commitClips(next: HistoryEntry[]) {
    setEntries(next)
    if (next.length === 0) chrome.storage.local.set({ clips: [] }, () => chrome.storage.local.remove(['history']))
    else chrome.storage.local.set({ clips: next })
  }

  // Deleting anything is reversible for a few seconds via the undo bar, so no
  // blocking confirm on the small stuff — undo beats a dialog for frequent,
  // low-stakes removes (design rule: always offer a way back). `snapshot` is
  // the whole pre-delete array, so one restore path covers single + bulk.
  function stageUndo(snapshot: HistoryEntry[], label: string) {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo({ snapshot, label })
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000)
  }

  function removeClip(entry: HistoryEntry) {
    const snapshot = entries
    commitClips(entries.filter(e => e.savedAt !== entry.savedAt))
    stageUndo(snapshot, 'Clip removed from history')
  }

  function clearClips(toRemove: HistoryEntry[]) {
    if (toRemove.length === 0) return
    const snapshot = entries
    const removeIds = new Set(toRemove.map(e => e.savedAt))
    commitClips(entries.filter(e => !removeIds.has(e.savedAt)))
    stageUndo(snapshot, `${toRemove.length} clip${toRemove.length !== 1 ? 's' : ''} removed`)
    setClearConfirming(false)
  }

  function applyUndo() {
    if (!undo) return
    commitClips(undo.snapshot)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo(null)
  }

  function dismissReflectionNudge(url: string, count: number) {
    const dismissed = { url, count }
    setReflectionDismissed(dismissed)
    chrome.storage.local.set({ reflectionNudgeDismissed: dismissed })
  }

  // "Add a note" works on ANY clip that has a Doc bookmark (namedRangeId) — not
  // just the Resurfaced spotlight. Keyed by savedAt (a stable clip identity, not
  // the render `key`) so opening one card's note box can't leak into another's.
  const [noteOpenFor, setNoteOpenFor] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteStatus, setNoteStatus] = useState('')
  // Which card's "···" menu (Archived / Add a note / …) is open, if any —
  // same savedAt-keyed shape as noteOpenFor, for the same reason.
  const [cardMenuOpenFor, setCardMenuOpenFor] = useState<number | null>(null)
  // Which card's Cite style menu is open, if any (same keying).
  const [citeMenuOpenFor, setCiteMenuOpenFor] = useState<number | null>(null)

  async function handleAddDocNote(entry: HistoryEntry) {
    const note = noteDraft.trim()
    if (!note || !entry.namedRangeId || !entry.destinationId) return

    setNoteStatus('Adding…')
    const msg: AddDocNoteMessage = {
      type: 'ADD_DOC_NOTE',
      payload: {
        destinationId: entry.destinationId,
        namedRangeId: entry.namedRangeId,
        note,
        entrySavedAt: entry.savedAt,
      },
    }
    const res: AddDocNoteResponse = await chrome.runtime.sendMessage(msg)

    if (res?.success) {
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const dated = `(${dateStr}) ${note}`
      // Reflect it locally right away — mirrors what the background just wrote,
      // so the card updates without waiting for a storage round-trip.
      setEntries(prev => prev.map(e => e.savedAt === entry.savedAt
        ? { ...e, note: e.note ? `${e.note}\n${dated}` : dated }
        : e))
      setNoteOpenFor(null)
      setNoteDraft('')
      setNoteStatus('')
    } else {
      setNoteStatus(res?.error ?? 'Could not add note')
    }
  }

  function toggleConfusion(entry: HistoryEntry) {
    const next = !entry.confused
    const msg: FlagConfusionMessage = { type: 'FLAG_CONFUSION', payload: { savedAt: entry.savedAt, confused: next } }
    chrome.runtime.sendMessage(msg).catch(() => {})
    // Optimistic mirror; the storage listener reconciles (and delivers the
    // ladder when the background finishes building it).
    setEntries(prev => prev.map(e => e.savedAt === entry.savedAt ? { ...e, confused: next } : e))
  }

  async function handleAskFollowUp(entry: HistoryEntry) {
    setFollowUpOpenFor(entry.savedAt)
    setFollowUpQuestions([])
    setFollowUpStatus('Thinking…')
    const msg: AskFollowUpMessage = { type: 'ASK_FOLLOWUP', payload: { text: entry.text } }
    const res: AskFollowUpResponse = await chrome.runtime.sendMessage(msg)
    if (res.success && res.questions?.length) {
      setFollowUpQuestions(res.questions)
      setFollowUpStatus('')
    } else {
      setFollowUpStatus(res.error ?? 'Could not get follow-up questions')
    }
  }

  function clipCard(entry: HistoryEntry, key: string, resurfaced = false) {
    const doc = docHref(entry)
    const archiveUrl = archivedUrls[entry.sourceUrl]
    // Retrieval Flip: question-first only when BROWSING — an active search
    // must show the matched text (the user is locating, not studying). The
    // question block stays visible after reveal so the see-question →
    // attempt-recall → check-against-clip beat reads in order.
    const hasQuestion = !!entry.retrievalQuestion && !query.trim()
    const flipped = hasQuestion && !revealed.has(key)
    return (
      <div
        key={key}
        className={`history-item${resurfaced ? ' resurfaced' : ''}${feedback?.key === key ? ' show-actions' : ''}`}
      >
        {hasQuestion && (
          <div className="history-question">
            <MdHelpOutline size={14} className="history-question-icon" />
            <span>{entry.retrievalQuestion}</span>
          </div>
        )}
        {flipped ? (
          <button
            className="history-reveal"
            onClick={() => setRevealed(prev => new Set(prev).add(key))}
          >
            Show the clip
          </button>
        ) : hasQuestion ? (
          /* Revealed as an answer check — the full clip IS the payoff; an
             80-char preview would cut the answer off mid-sentence. */
          <div className="history-text">{entry.text}</div>
        ) : (
          <div className="history-text">{entry.text.slice(0, 80)}{entry.text.length > 80 ? '…' : ''}</div>
        )}
        {/* The margin note usually paraphrases the clip, so while the card is
            flipped it would hand over the answer — hidden until reveal. */}
        {entry.note && !flipped && (
          <div className="history-note"><MdSubdirectoryArrowRight size={13} /> {renderNoteWithTags(entry.note, setQuery)}</div>
        )}
        <div className="history-meta">
          {entry.predicted && <span className="history-predicted">☀ prediction</span>}
          {entry.confused && <span className="history-foggy">? foggy</span>}
          <span className="history-source">{entry.sourceTitle}</span>
          <span className="history-dot">·</span>
          <span className="history-dest">{entry.destinationName}</span>
          <span className="history-dot">·</span>
          <span className="history-time">{timeAgo(entry.savedAt)}</span>
        </div>
        {/* Reveal-on-hover, smoothly. `.history-actions-row` is a grid whose
            single row animates 0fr → 1fr (the real content height, no
            max-height overshoot), and `.history-actions-inner` is the
            overflow-clipped flex row of buttons. The pop-open menus are
            SIBLINGS of the row (children of the position:relative wrapper),
            not inside the clipped row, so the clip never eats them. */}
        <div className="history-actions">
          <div className="history-actions-row">
            <div className="history-actions-inner">
              <a
                className="hist-action"
                href={sourceHref(entry)}
                target="_blank"
                rel="noreferrer"
                title={entry.kind === 'image' ? 'Open the source page' : 'Open source and highlight this clip'}
              >
                <MdOpenInNew size={13} /> Source
              </a>
              {doc && (
                <a className="hist-action" href={doc} target="_blank" rel="noreferrer" title="Open in Google Doc">
                  <MdDescription size={13} /> Doc
                </a>
              )}
              <button
                className={`hist-action${entry.cited ? ' active' : ''}${citeMenuOpenFor === entry.savedAt ? ' active' : ''}`}
                onClick={() => { setCiteMenuOpenFor(prev => prev === entry.savedAt ? null : entry.savedAt); setCardMenuOpenFor(null) }}
                title="Copy a citation"
              >
                {feedback?.key === key
                  ? (feedback.label ?? (feedback.ok ? <><MdCheck size={13} /> Copied</> : 'Copy failed'))
                  : (entry.cited ? <><MdCheck size={13} /> Cited</> : <><MdContentCopy size={13} /> Cite</>)}
              </button>
              <button
                className="card-menu-btn"
                onClick={() => { setCardMenuOpenFor(prev => prev === entry.savedAt ? null : entry.savedAt); setCiteMenuOpenFor(null) }}
                title="More"
              >
                <MdMoreHoriz size={16} />
              </button>
            </div>
          </div>

          {citeMenuOpenFor === entry.savedAt && (
            <CiteMenu
              current={citeStyle}
              onPick={(style) => { handleCite(entry, key, style); setCiteMenuOpenFor(null) }}
              onClose={() => setCiteMenuOpenFor(null)}
            />
          )}
          {cardMenuOpenFor === entry.savedAt && (
            <HistoryCardMenu
              archiveUrl={archiveUrl}
              onAddNote={entry.namedRangeId ? () => {
                setNoteOpenFor(prev => prev === entry.savedAt ? null : entry.savedAt)
                setCardMenuOpenFor(null)
              } : undefined}
              onRemove={() => { removeClip(entry); setCardMenuOpenFor(null) }}
              onAskFollowUp={aiConnected ? () => { handleAskFollowUp(entry); setCardMenuOpenFor(null) } : undefined}
              onStudyDoc={entry.retrievalQuestion && entry.destinationId
                ? () => { openStudy(entry.destinationId); setCardMenuOpenFor(null) }
                : undefined}
              onToggleConfusion={aiConnected && entry.kind !== 'image'
                ? () => { toggleConfusion(entry); setCardMenuOpenFor(null) }
                : undefined}
              confused={entry.confused}
              onClose={() => setCardMenuOpenFor(null)}
            />
          )}
        </div>

        {followUpOpenFor === entry.savedAt && (
          <div className="ai-summary-box">
            <div className="ai-summary-head">
              <span className="ai-summary-label"><MdAutoAwesome size={13} /> Follow-up questions</span>
              <button className="ai-summary-close" onClick={() => setFollowUpOpenFor(null)} title="Close">
                <MdClose size={14} />
              </button>
            </div>
            {followUpStatus && <p className="ai-summary-status">{followUpStatus}</p>}
            {followUpQuestions.length > 0 && (
              <ul className="ai-followup-list">
                {followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            )}
          </div>
        )}

        {noteOpenFor === entry.savedAt && entry.namedRangeId && (
          <div className="doc-note-box">
            <textarea
              className="doc-note-input"
              placeholder="What do you think now?"
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              autoFocus
            />
            <div className="doc-note-foot">
              <span className="doc-note-status">{noteStatus}</span>
              <button className="doc-note-save" onClick={() => handleAddDocNote(entry)}>
                Add to Doc
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="tab-content empty-state">
        <div className="empty-icon"><MdInbox /></div>
        <div className="empty-text">No clips saved yet</div>
        <div className="empty-sub">Select text on any page and click Save to Notes</div>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const base = entries
  // Docs available to filter by — count each so the menu shows how many clips
  // land in each doc. Only clips that carry a destinationId are filterable
  // (legacy clips without one aren't).
  const docCounts = new Map<string, DocOption>()
  for (const e of base) {
    if (!e.destinationId) continue
    const cur = docCounts.get(e.destinationId)
    if (cur) cur.count++
    else docCounts.set(e.destinationId, { id: e.destinationId, name: e.destinationName, count: 1 })
  }
  const docOptions = [...docCounts.values()].sort((a, b) => b.count - a.count)
  // A filter that can only pick the one existing doc is pointless — only offer
  // it once there are at least two docs to choose between (progressive disclosure).
  const canFilterByDoc = docOptions.length > 1
  // If docs drop to ≤1 (or the filtered doc no longer has clips), the filter
  // auto-disables so the view can't get stuck showing nothing with no way out.
  const effectiveDocFilter = canFilterByDoc && docFilter && docCounts.has(docFilter) ? docFilter : null
  const activeDocName = effectiveDocFilter ? docCounts.get(effectiveDocFilter)!.name : null

  const filtered = base.filter(e => {
    if (effectiveDocFilter && e.destinationId !== effectiveDocFilter) return false
    if (!q) return true
    return e.text.toLowerCase().includes(q) ||
      e.sourceTitle.toLowerCase().includes(q) ||
      e.destinationName.toLowerCase().includes(q) ||
      e.sourceUrl.toLowerCase().includes(q) ||
      (e.note?.toLowerCase().includes(q) ?? false)
  })
  const visible = filtered.slice(0, MAX_VISIBLE)
  // The bottom clear control acts on "whatever you're looking at": if the view
  // is narrowed (search / doc filter) it clears just that subset ("Clear
  // these N"); otherwise it clears the whole archive ("Clear all history").
  const isNarrowed = !!q || !!effectiveDocFilter
  const clearTarget = isNarrowed ? filtered : entries
  // Clips saved to a done project are excluded from the proactive pickers —
  // the main list above is untouched, so old work is still findable/citable.
  const activeEntries = entries.filter(e => !e.destinationId || !doneDestIds.has(e.destinationId))
  // Resurfaced is paused for now (kept, not deleted — see pickResurfaced
  // below) — hardcoding null both skips the JSX block (it's gated on
  // `resurfaced &&`) and skips computing it at all. Re-enable by restoring
  // `q ? null : pickResurfaced(activeEntries)`.
  const resurfaced = null as ReturnType<typeof pickResurfaced>
  const reflectionRaw = q ? null : pickReflectionNudge(activeEntries)
  // Suppressed once dismissed at this exact streak length or longer — but a
  // streak that keeps growing after dismissal surfaces again, since the
  // pattern it's flagging is getting more pronounced, not less.
  const reflectionNudge = reflectionRaw && !(
    reflectionDismissed?.url === reflectionRaw.url && reflectionDismissed.count >= reflectionRaw.count
  ) ? reflectionRaw : null

  return (
    <div className="tab-content">
      {/* Top controls form one proximity group — the count/filter header and
          search belong together and stay tightly spaced, with a single larger
          gap separating the cluster from the clip list. (Citation style used
          to live here as a persistent "Cite as" strip; it moved into the
          per-card Cite action — most users never cite, so it shouldn't own
          prime real estate or expose APA/MLA/BibTeX jargon by default.) */}
      <div className="history-controls">
        <div className="history-header">
          <span className="muted">{entries.length} clip{entries.length !== 1 ? 's' : ''}</span>
          <div className="history-header-actions">
            {canFilterByDoc && (
              <div className="filter-wrap">
                <button
                  className={`header-pill${activeDocName ? ' active' : ''}`}
                  onClick={() => setFilterMenuOpen(v => !v)}
                  title={activeDocName ? `Filtering by ${activeDocName}` : 'Filter by document'}
                >
                  <MdFilterList size={13} /> Filter
                </button>
                {filterMenuOpen && (
                  <FilterMenu
                    options={docOptions}
                    current={effectiveDocFilter}
                    onPick={(id) => { setDocFilter(id); setFilterMenuOpen(false) }}
                    onClose={() => setFilterMenuOpen(false)}
                  />
                )}
              </div>
            )}
            {/* "Clear" is NOT here anymore — a destructive, rare action doesn't
                belong in the prime top-right zone next to the safe filters
                (accidental-tap risk + wrong visual weight). It lives at the
                bottom of the list instead; see the clear control below. */}
          </div>
        </div>

        <input
          className="history-search"
          type="search"
          placeholder="Search your clips…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />

        {/* Active-filter status as a removable chip — keeps the header trigger
            a fixed-width "Filter" pill (no crowding) while still showing which
            doc is filtered and giving a large one-click clear target. */}
        {activeDocName && (
          <button className="filter-active-chip" onClick={() => setDocFilter(null)} title="Clear filter">
            <MdFilterList size={12} />
            <span className="filter-active-name">{activeDocName}</span>
            <MdClose size={13} />
          </button>
        )}
      </div>

      {resurfaced && (
        <>
          <div className="resurface-label"><MdAutoAwesome size={13} /> Resurfaced</div>
          {clipCard(resurfaced, 'resurface', true)}
        </>
      )}

      {reflectionNudge && (
        <div className="reflection-nudge">
          <span className="reflection-nudge-text">
            <MdLightbulb size={13} /> {reflectionNudge.count} clips from "{reflectionNudge.title}", no notes yet — what's the throughline?
          </span>
          <span className="reflection-nudge-actions">
            <button className="reflection-nudge-look" onClick={() => setQuery(reflectionNudge.title)}>
              Look back
            </button>
            <button
              className="reflection-nudge-dismiss"
              onClick={() => dismissReflectionNudge(reflectionNudge.url, reflectionNudge.count)}
            >
              Dismiss
            </button>
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="muted history-empty-search">
          {activeDocName
            ? (q ? `No clips in ${activeDocName} match "${query}".` : `No clips in ${activeDocName}.`)
            : `No clips match "${query}".`}
        </div>
      ) : (
        <div className="history-list">
          {visible.map((entry, i) => clipCard(entry, `${entry.savedAt}-${i}`))}
        </div>
      )}

      {filtered.length > visible.length && (
        <div className="muted history-more">Showing first {visible.length} of {filtered.length} — search to narrow.</div>
      )}

      {/* Clear control lives at the END of the list, out of the accidental-tap
          path — reached by a deliberate scroll. Acts on the current view, so
          it's "Clear these N" when narrowed and "Clear all history" otherwise.
          Inline confirm (high stakes) + undo bar (recoverable) both guard it. */}
      {clearTarget.length > 0 && (
        clearConfirming ? (
          <div className="clear-confirm">
            <span className="clear-confirm-text">
              Clear {clearTarget.length} clip{clearTarget.length !== 1 ? 's' : ''}? Your Google Doc keeps the text — this only wipes SnipKeep's local history.
            </span>
            <div className="clear-confirm-actions">
              <button className="card-menu-cancel" onClick={() => setClearConfirming(false)}>Cancel</button>
              <button className="card-menu-confirm-remove" onClick={() => clearClips(clearTarget)}>
                {isNarrowed ? 'Clear these' : 'Clear all'}
              </button>
            </div>
          </div>
        ) : (
          <button className="clear-history-btn" onClick={() => setClearConfirming(true)}>
            <MdDeleteOutline size={14} />
            {isNarrowed ? `Clear these ${clearTarget.length}` : 'Clear all history'}
          </button>
        )
      )}

      {undo && (
        <div className="undo-bar">
          <span className="undo-bar-label">{undo.label}</span>
          <button className="undo-btn" onClick={applyUndo}>Undo</button>
        </div>
      )}
    </div>
  )
}

// ── Privacy Ledger ───────────────────────────────────────────────────────────
// A literal, honest account of what leaves the device — not a policy to trust,
// a description of the architecture that's already true. See CLAUDE.md's
// message-flow section for the underlying facts this restates in plain language.

const PRIVACY_ITEMS: { ok: boolean; title: string; body: string }[] = [
  {
    ok: true,
    title: 'Your clip → your Google Doc',
    body: "Saved straight to Google's Docs API using your own Google sign-in. SnipKeep never sees it in between.",
  },
  {
    ok: true,
    title: 'Your archive stays on this device',
    body: 'Clips, history, and your doc list live in this browser’s local storage — never uploaded to a server.',
  },
  {
    ok: true,
    title: 'Settings sync through Google, not us',
    body: 'Which docs you use and your citation style sync via Chrome’s own built-in sync — the same system that syncs your bookmarks.',
  },
  {
    ok: false,
    title: 'A SnipKeep server',
    body: "There isn't one. Nothing to breach, nothing to sell.",
  },
]

export function PrivacyLedger({ onBack, onShowTrust }: { onBack: () => void; onShowTrust: () => void }) {
  return (
    <div className="tab-content privacy-ledger">
      <button className="privacy-back" onClick={onBack}>&larr; Back</button>

      <div className="section">
        <span className="section-label">What leaves your device</span>
        <p className="privacy-lede">A literal account of where your data goes — not a policy to trust, a description of what's already true.</p>
      </div>

      <div className="privacy-list">
        {PRIVACY_ITEMS.map((item, i) => (
          <div key={i} className={`privacy-item ${item.ok ? 'ok' : 'no'}`}>
            <span className="privacy-icon">{item.ok ? <MdCheck /> : <MdClose />}</span>
            <div>
              <div className="privacy-item-title">{item.title}</div>
              <div className="privacy-item-body">{item.body}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="privacy-closing">
        If SnipKeep disappeared tomorrow, every clip you've saved would still open normally in your own Google Doc.
      </p>

      <a className="privacy-open-docs" href="https://docs.google.com/" target="_blank" rel="noreferrer">
        Open Google Docs &#8599;
      </a>

      <button className="privacy-trust-link" onClick={onShowTrust}>
        Why your archive is safe if SnipKeep disappears &rarr;
      </button>
    </div>
  )
}

// ── Trust Card ────────────────────────────────────────────────────────────────
// Shown once, automatically, right after the first destination doc is added (the
// exact moment the user hands SnipKeep write-access to a Doc) — and reachable
// again afterward from the Privacy Ledger. Gated by `hasSeenTrustCard` (sync),
// set by the Drawer, which owns the auto-trigger + view-switching logic.

function googleDocUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/edit`
}

export function TrustCard({ firstDocId, onDismiss }: { firstDocId: string | null; onDismiss: () => void }) {
  const docUrl = firstDocId ? googleDocUrl(firstDocId) : 'https://docs.google.com/'
  return (
    <div className="tab-content trust-card">
      <div className="trust-badge">&#128193;</div>
      <div className="trust-title">Your Doc is the real thing. SnipKeep is just how it got there.</div>
      <p className="trust-body">
        Every clip is written straight into a Google Doc you already own. Nothing lives in a SnipKeep
        database — there isn't one. If SnipKeep disappeared tomorrow, your Doc wouldn't even notice.
      </p>
      <a className="trust-open-doc" href={docUrl} target="_blank" rel="noreferrer">
        Open your Doc right now &#8599;
      </a>
      <button className="trust-dismiss" onClick={onDismiss}>Got it</button>
    </div>
  )
}

// ── AI Assistant (docs/IDEAS.md #3) ─────────────────────────────────────────────
// Bring-your-own-key: SnipKeep never sees or relays the key. Connect/manage
// only — the actual classify/summarize actions aren't built yet (see the
// idea note). Reached from the Drawer's always-visible "✨ AI" header button
// (the showcase entry point); this screen is the "hidden inside" detail work,
// same nested-view pattern as Privacy Ledger.

const AI_PROVIDERS: { id: AIProvider; name: string; keyUrl: string }[] = [
  { id: 'gemini', name: 'Gemini', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'anthropic', name: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'ChatGPT', keyUrl: 'https://platform.openai.com/api-keys' },
]

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function AIAssistant({ onBack }: { onBack: () => void }) {
  const [config, setConfig] = useState<AIConfig | null | undefined>(undefined) // undefined = still loading
  const [selected, setSelected] = useState<(typeof AI_PROVIDERS)[number] | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle')
  const [error, setError] = useState('')
  // Disconnect swaps to an inline confirm (the established high-stakes
  // pattern — same as History's bulk Clear), never a blocking dialog.
  const [disconnectConfirming, setDisconnectConfirming] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(['aiConfig'], (result) => {
      setConfig((result.aiConfig as AIConfig | undefined) ?? null)
    })
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && 'aiConfig' in changes) {
        setConfig((changes.aiConfig.newValue as AIConfig | undefined) ?? null)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  // Selection ONLY — no navigation side effect. The old version also
  // window.open()ed the provider's key page on click, which collapsed two
  // actions into one control: a user comparing providers got yanked to an
  // external site for what read as picking a radio option. Navigation now
  // lives in its own explicit affordance (the ↗ link on each card and in the
  // key-entry hint), so choosing and leaving are separate, reversible acts.
  function selectProvider(p: (typeof AI_PROVIDERS)[number]) {
    setSelected(p)
    setKeyInput('')
    setStatus('idle')
    setError('')
  }

  async function handleConnect() {
    if (!selected || !keyInput.trim()) return
    setStatus('connecting')
    setError('')
    const msg: ConnectAIMessage = { type: 'CONNECT_AI', payload: { provider: selected.id, apiKey: keyInput.trim() } }
    const res: ConnectAIResponse = await chrome.runtime.sendMessage(msg)
    if (res.success) {
      setSelected(null)
      setKeyInput('')
      setStatus('idle')
    } else {
      setStatus('error')
      setError(res.error ?? 'Connection failed')
    }
  }

  async function handleDisconnect() {
    const msg: DisconnectAIMessage = { type: 'DISCONNECT_AI' }
    const res: DisconnectAIResponse = await chrome.runtime.sendMessage(msg)
    if (res.success) {
      setConfig(null)
      setDisconnectConfirming(false)
    }
  }

  return (
    <div className="tab-content ai-assistant">
      <button className="privacy-back" onClick={onBack}>&larr; Back</button>

      <div className="section">
        <span className="section-label">AI assistant</span>
        <p className="privacy-lede">
          Optional, and bring-your-own: SnipKeep never sees or relays your key — requests go straight from
          your browser to your own account.
        </p>
      </div>

      {config === undefined ? null : config ? (
        <div className="ai-connected">
          <div className="ai-connected-row">
            <span className="ai-connected-icon"><MdCheckCircle /></span>
            <div>
              <div className="ai-connected-title">
                Connected to {AI_PROVIDERS.find((p) => p.id === config.provider)?.name ?? config.provider}
              </div>
              <div className="ai-connected-key">{maskKey(config.apiKey)}</div>
            </div>
          </div>
          {disconnectConfirming ? (
            <div className="clear-confirm">
              <span className="clear-confirm-text">
                Disconnect {AI_PROVIDERS.find((p) => p.id === config.provider)?.name ?? 'this provider'}?
                The key is removed from this device and AI features pause — summaries, follow-up
                questions, and practice questions for new clips. Everything already saved (your clips,
                existing questions, your Doc) stays exactly as it is.
              </span>
              <div className="clear-confirm-actions">
                <button className="card-menu-cancel" onClick={() => setDisconnectConfirming(false)}>
                  Keep connected
                </button>
                <button className="card-menu-confirm-remove" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="ai-disconnect-row">
              <button className="btn-ghost danger small" onClick={() => setDisconnectConfirming(true)}>
                <MdDeleteOutline size={13} /> Disconnect
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* A real radio group: clicking a row selects, nothing else. The ↗
              is its own separated link (a SIBLING of the select button inside
              the card wrapper — never nested, per the button-in-button
              gotcha), so leaving for the provider's key page is always the
              user's explicit choice, available before OR after selecting. */}
          <div className="ai-provider-list" role="radiogroup" aria-label="AI provider">
            {AI_PROVIDERS.map((p) => (
              <div key={p.id} className={`ai-provider-card ${selected?.id === p.id ? 'active' : ''}`}>
                <button
                  className="ai-provider-select"
                  role="radio"
                  aria-checked={selected?.id === p.id}
                  onClick={() => selectProvider(p)}
                >
                  <span className="ai-radio" aria-hidden="true" />
                  <span className="ai-provider-name">{p.name}</span>
                </button>
                <a
                  className="ai-provider-open"
                  href={p.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${p.name}'s API key page in a new tab`}
                  title="Open the API key page"
                >
                  <MdOpenInNew size={14} />
                </a>
              </div>
            ))}
          </div>

          {selected && (
            <div className="ai-key-entry">
              <p className="hint">
                Create a key on{' '}
                <a className="ai-key-page-link" href={selected.keyUrl} target="_blank" rel="noreferrer">
                  {selected.name}'s key page <MdOpenInNew size={11} />
                </a>
                , then paste it below.
              </p>
              <input
                className="input mono-input"
                type="password"
                placeholder="Paste your API key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoFocus
              />
              {status === 'error' && <p className="ai-key-error">{error}</p>}
              <button
                className="btn-primary full-width"
                disabled={!keyInput.trim() || status === 'connecting'}
                onClick={handleConnect}
              >
                {status === 'connecting' ? 'Connecting…' : `Connect ${selected.name}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
// Auth state lives here so the gate screen and the main UI are siblings.
// The drawer header reads userEmail from chrome.storage independently.

export function Popup() {
  const [tab, setTab] = useState<Tab>('docs')
  const [isSignedIn, setIsSignedIn] = useState(false)
  // "Cite them →" (Deadline-Aware Citations) jumps tabs and drops a filter
  // into History's search box — lifted here since DocsTab and History are
  // siblings, neither can reach into the other directly.
  const [historyFilter, setHistoryFilter] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.sync.get(['isSignedIn'], (result) => {
      if (result.isSignedIn) setIsSignedIn(true)
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('isSignedIn' in changes) setIsSignedIn(!!changes.isSignedIn.newValue)
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  // The gate runs in the content-script context, where chrome.identity is
  // undefined. Route the interactive OAuth flow to the background worker.
  async function handleSignIn(): Promise<void> {
    const msg: SignInMessage = { type: 'SIGN_IN' }
    const res: SignInResponse = await chrome.runtime.sendMessage(msg)
    if (!res.success) throw new Error(res.error ?? 'Sign-in failed')
    setIsSignedIn(true)
  }

  if (!isSignedIn) {
    return <GateScreen onSignIn={handleSignIn} />
  }

  return (
    <div className="popup">
      <div className="header">
        <span className="logo">Snip<span>Keep</span></span>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'docs' ? 'active' : ''}`} onClick={() => setTab('docs')}>
          Docs
        </button>
        <button className={`tab ${tab === 'completed' ? 'active' : ''}`} onClick={() => setTab('completed')}>
          Completed
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'docs' ? (
        <DocsTab onJumpToHistory={(docName) => { setHistoryFilter(docName); setTab('history') }} />
      ) : tab === 'completed' ? (
        <CompletedTab />
      ) : (
        <History initialFilter={historyFilter} onFilterConsumed={() => setHistoryFilter(null)} />
      )}
    </div>
  )
}
