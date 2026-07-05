import React, { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
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
} from '../types'

type Tab = 'docs' | 'history'

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
      <div className="gate-logo">Snip<span>Keep</span></div>
      <p className="gate-tagline">Save what you read,<br />exactly where you write.</p>
      <button className="btn-primary full-width" onClick={handleClick} disabled={loading}>
        {loading ? 'Connecting…' : 'Connect with Google'}
      </button>
      {error && <p className="gate-error">{error}</p>}
      <p className="gate-note">Uses your existing Chrome profile — no new account needed</p>
    </div>
  )
}

// ── Docs Tab ──────────────────────────────────────────────────────────────────
// The destination docs your clips save into. Auth lives in the drawer header.

function DocsTab() {
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [newDocId, setNewDocId] = useState('')
  const [newDocName, setNewDocName] = useState('')
  const [isFetchingTitle, setIsFetchingTitle] = useState(false)
  const [nameEditMode, setNameEditMode] = useState(false)
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [notionPageName, setNotionPageName] = useState('')
  const [flash, setFlash] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [docStats, setDocStats] = useState<DocStats>({})

  const nameTouchedRef = useRef(false)
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    // Per-doc clip stats live in storage.local → durable across drawer
    // close/reopen and browser restarts. Read on mount, then stay in sync
    // so a clip made while the drawer is open updates the count live.
    chrome.storage.local.get(['docStats'], (result) => {
      setDocStats((result.docStats as DocStats) ?? {})
    })

    const onStatsChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === 'local' && changes.docStats) {
        setDocStats((changes.docStats.newValue as DocStats) ?? {})
      }
    }
    chrome.storage.onChanged.addListener(onStatsChange)
    return () => chrome.storage.onChanged.removeListener(onStatsChange)
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
      if (nameTouchedRef.current) return
      setIsFetchingTitle(true)
      const title = await getDocTitle(id)
      setIsFetchingTitle(false)
      if (title) setNewDocName(title)
    }, 600)
  }

  function handleNameChange(value: string) {
    setNewDocName(value)
    nameTouchedRef.current = true
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
    setNameEditMode(false)
    setIsAdding(false)
    nameTouchedRef.current = false
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
    setNameEditMode(false)
    nameTouchedRef.current = false
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

  return (
    <div className="tab-content">
      {/* The tab label "Docs" already names this — no redundant section header */}
      <div className="section">
        {docs.length > 0 && (
          <div className="doc-list">
            {docs.map(doc => (
              <div key={doc.id} className={`doc-item${doc.active ? '' : ' inactive'}`}>
                <div className="doc-info">
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-meta">{formatDocMeta(docStats[doc.id])}</div>
                </div>
                <button
                  className={`btn-toggle${doc.active ? ' on' : ' off'}`}
                  onClick={() => handleToggleDoc(doc.id)}
                  title={doc.active ? 'Hide from toolbar' : 'Show in toolbar'}
                />
                <button className="btn-remove" onClick={() => handleRemoveDoc(doc.id)} title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}

        {docs.length === 0 && !isAdding && (
          <p className="hint">Add a Google Doc to start clipping into it.</p>
        )}

        {flash && <div className="flash">{flash}</div>}

        {/* Form is revealed on demand — or always open on first run (no docs yet) */}
        {(isAdding || docs.length === 0) ? (
          <div className="add-form">
            <div className="input-group">
              <div className="field">
                <span className="field-label">Google Doc URL</span>
                <input
                  className="field-input mono"
                  value={newDocId}
                  onChange={e => handleDocUrlChange(e.target.value)}
                  placeholder="Paste URL or Doc ID"
                  spellCheck={false}
                  autoFocus={isAdding}
                />
              </div>

              {newDocId.trim() && (
                <div className="field name-preview-field">
                  <span className="field-label">
                    Name {isFetchingTitle && <span className="field-fetching">fetching…</span>}
                  </span>
                  {nameEditMode ? (
                    <input
                      className="field-input"
                      value={newDocName}
                      onChange={e => handleNameChange(e.target.value)}
                      placeholder="Enter a name"
                      autoFocus
                      onBlur={() => { if (!newDocName.trim()) setNameEditMode(false) }}
                    />
                  ) : (
                    <div className="name-preview" onClick={() => setNameEditMode(true)}>
                      <span className="name-preview-text">
                        {isFetchingTitle ? '' : (newDocName || 'My Notes')}
                      </span>
                      <span className="name-preview-edit" title="Edit name">✎</span>
                    </div>
                  )}
                </div>
              )}
            </div>

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
        ) : (
          <button className="btn-add-trigger" onClick={() => setIsAdding(true)}>
            <Plus size={16} strokeWidth={2.5} className="btn-add-icon" />
            Add document
          </button>
        )}
      </div>

      {/* Notion — hidden until ready */}
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

// Deterministically pick one clip to "resurface" per day, preferring clips older
// than a day so it feels like revisiting, not re-reading what you just saved.
// Someday-tagged clips are excluded — they've already been triaged once.
function pickResurfaced(clips: HistoryEntry[]): HistoryEntry | null {
  const pool = clips.filter(c => !c.someday)
  if (pool.length < 3) return null
  const now = Date.now()
  const eligible = pool.filter(c => now - c.savedAt > DAY_MS)
  const finalPool = eligible.length ? eligible : pool
  const daySeed = Math.floor(now / DAY_MS)
  return finalPool[daySeed % finalPool.length]
}

// Soft Triage — the calm alternative to a Burn-451-style delete-if-unread
// countdown. Old, never-revisited, not-yet-triaged clips occasionally surface
// a "still relevant?" check-in with zero consequence for ignoring it: nothing
// is ever deleted, and skipping just means asking again some other day.
const TRIAGE_MIN_AGE_MS = 14 * DAY_MS

function pickTriageCandidate(clips: HistoryEntry[], excludeSavedAt: number | null): HistoryEntry | null {
  const now = Date.now()
  const pool = clips.filter(c =>
    !c.someday &&
    c.savedAt !== excludeSavedAt &&
    now - c.savedAt > TRIAGE_MIN_AGE_MS
  )
  if (pool.length < 3) return null  // too small an archive to bother triaging yet
  const daySeed = Math.floor(now / DAY_MS)
  // Offset from pickResurfaced's index so the two picks don't usually coincide
  // even when the pools happen to be the same size.
  return pool[(daySeed + 7) % pool.length]
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

function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [citeStyle, setCiteStyle] = useState<CitationStyle>('apa')
  const [feedback, setFeedback] = useState<{ key: string; text: string } | null>(null)
  const [query, setQuery] = useState('')
  // Page url → Wayback Machine snapshot url. Populated by the background's
  // link-rot insurance a few seconds after a save; listened for live so the
  // "🏛 Archived" link can appear without reopening the drawer.
  const [archivedUrls, setArchivedUrls] = useState<Record<string, string>>({})
  // Soft Triage: hide Someday clips from the main list by default (an escape
  // hatch, not a filter you have to remember to apply); and the day-seed of
  // the last time a triage check-in was answered/skipped, so it doesn't nag
  // again until a new day rotates the pick.
  const [showSomedayOnly, setShowSomedayOnly] = useState(false)
  const [triageDismissedDay, setTriageDismissedDay] = useState<number | null>(null)

  useEffect(() => {
    chrome.storage.local.get(['clips', 'history', 'archivedUrls', 'triageDismissedDay'], (result) => {
      const clips = result.clips as HistoryEntry[] | undefined
      // Fall back to the legacy recent-10 store until the archive is seeded.
      setEntries(clips && clips.length ? clips : ((result.history as HistoryEntry[]) ?? []))
      setArchivedUrls((result.archivedUrls as Record<string, string>) ?? {})
      setTriageDismissedDay((result.triageDismissedDay as number | undefined) ?? null)
    })
    chrome.storage.sync.get(['citationStyle'], (result) => {
      const s = result.citationStyle as CitationStyle | undefined
      if (s === 'apa' || s === 'mla' || s === 'bibtex') setCiteStyle(s)
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('archivedUrls' in changes) {
        setArchivedUrls((changes.archivedUrls.newValue as Record<string, string>) ?? {})
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  function pickStyle(style: CitationStyle) {
    setCiteStyle(style)
    chrome.storage.sync.set({ citationStyle: style })
  }

  async function handleCite(entry: HistoryEntry, key: string) {
    const ok = await copyToClipboard(formatCitation(entry, citeStyle))
    setFeedback({ key, text: ok ? 'Copied ✓' : 'Copy failed' })
    setTimeout(() => setFeedback(prev => (prev?.key === key ? null : prev)), 1400)
  }

  function handleClear() {
    chrome.storage.local.remove(['clips', 'history'])
    setEntries([])
  }

  // Someday is purely local archive metadata — never touches the Doc, so no
  // background round-trip or bookmark is needed; it works on every clip,
  // including ones saved before this feature existed.
  async function toggleSomeday(entry: HistoryEntry) {
    const next = !entry.someday
    setEntries(prev => prev.map(e => e.savedAt === entry.savedAt ? { ...e, someday: next } : e))
    const result = await chrome.storage.local.get(['clips'])
    const clips = (result.clips as HistoryEntry[]) ?? []
    const idx = clips.findIndex(c => c.savedAt === entry.savedAt)
    if (idx !== -1) {
      clips[idx] = { ...clips[idx], someday: next }
      await chrome.storage.local.set({ clips })
    }
  }

  // Answering OR skipping a triage check-in both just mean "don't ask again
  // today" — skipping has no other consequence, by design.
  function dismissTriageForToday() {
    const day = Math.floor(Date.now() / DAY_MS)
    setTriageDismissedDay(day)
    chrome.storage.local.set({ triageDismissedDay: day })
  }

  // "Add a note" works on ANY clip that has a Doc bookmark (namedRangeId) — not
  // just the Resurfaced spotlight. Keyed by savedAt (a stable clip identity, not
  // the render `key`) so opening one card's note box can't leak into another's.
  const [noteOpenFor, setNoteOpenFor] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteStatus, setNoteStatus] = useState('')

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

  function clipCard(entry: HistoryEntry, key: string, resurfaced = false) {
    const doc = docHref(entry)
    const archiveUrl = archivedUrls[entry.sourceUrl]
    return (
      <div key={key} className={`history-item${resurfaced ? ' resurfaced' : ''}`}>
        <div className="history-text">{entry.text.slice(0, 80)}{entry.text.length > 80 ? '…' : ''}</div>
        {entry.note && (
          <div className="history-note">↳ {renderNoteWithTags(entry.note, setQuery)}</div>
        )}
        <div className="history-meta">
          <span className="history-source">{entry.sourceTitle}</span>
          <span className="history-dot">·</span>
          <span className="history-dest">{entry.destinationName}</span>
          <span className="history-dot">·</span>
          <span className="history-time">{timeAgo(entry.savedAt)}</span>
        </div>
        <div className="history-actions">
          <a
            className="hist-action"
            href={sourceHref(entry)}
            target="_blank"
            rel="noreferrer"
            title={entry.kind === 'image' ? 'Open the source page' : 'Open source and highlight this clip'}
          >
            ↗ Source
          </a>
          {archiveUrl && (
            <a
              className="hist-action"
              href={archiveUrl}
              target="_blank"
              rel="noreferrer"
              title="Open a permanent snapshot — works even if the live page is gone"
            >
              🏛 Archived
            </a>
          )}
          {doc && (
            <a className="hist-action" href={doc} target="_blank" rel="noreferrer" title="Open in Google Doc">
              📄 Doc
            </a>
          )}
          <button
            className="hist-action"
            onClick={() => handleCite(entry, key)}
            title={`Copy ${citeStyle.toUpperCase()} citation`}
          >
            {feedback?.key === key ? feedback.text : '⧉ Cite'}
          </button>
          {entry.namedRangeId && (
            <button
              className="hist-action"
              onClick={() => setNoteOpenFor(prev => prev === entry.savedAt ? null : entry.savedAt)}
              title="Add a fresh note back into the Doc, right at this clip"
            >
              + Add a note
            </button>
          )}
          <button
            className={`hist-action${entry.someday ? ' active' : ''}`}
            onClick={() => toggleSomeday(entry)}
            title={entry.someday ? 'Remove from Someday' : 'Mark as Someday — deprioritize without deleting anything'}
          >
            {entry.someday ? '✓ Someday' : '🕒 Someday'}
          </button>
        </div>

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

  // Deliberately calm and low-stakes: dashed border, no accent color, and every
  // action (including doing nothing) just moves on — nothing is ever destroyed.
  function triageCard(entry: HistoryEntry) {
    return (
      <div className="triage-card">
        <div className="triage-label">🕒 Still relevant?</div>
        <div className="history-text">{entry.text.slice(0, 80)}{entry.text.length > 80 ? '…' : ''}</div>
        <div className="history-meta">
          <span className="history-source">{entry.sourceTitle}</span>
          <span className="history-dot">·</span>
          <span className="history-time">{timeAgo(entry.savedAt)}</span>
        </div>
        <div className="triage-actions">
          <button className="triage-btn-keep" onClick={dismissTriageForToday}>Yes, still relevant</button>
          <button
            className="triage-btn-someday"
            onClick={() => { toggleSomeday(entry); dismissTriageForToday() }}
          >
            Mark as Someday
          </button>
          <button className="triage-skip" onClick={dismissTriageForToday}>Not now</button>
        </div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="tab-content empty-state">
        <div className="empty-icon">📋</div>
        <div className="empty-text">No clips saved yet</div>
        <div className="empty-sub">Select text on any page and click Save to Notes</div>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const somedayCount = entries.filter(e => e.someday).length
  // Someday clips are hidden from the main list by default (the actual point —
  // fewer things staring at you — not just a filter you have to remember to
  // apply) but never further away than one click via the header toggle.
  const base = entries.filter(e => (showSomedayOnly ? e.someday : !e.someday))
  const filtered = q
    ? base.filter(e =>
        e.text.toLowerCase().includes(q) ||
        e.sourceTitle.toLowerCase().includes(q) ||
        e.destinationName.toLowerCase().includes(q) ||
        (e.note?.toLowerCase().includes(q) ?? false))
    : base
  const visible = filtered.slice(0, MAX_VISIBLE)
  const resurfaced = (q || showSomedayOnly) ? null : pickResurfaced(entries)
  const todaySeed = Math.floor(Date.now() / DAY_MS)
  const triageCandidate = (q || showSomedayOnly || triageDismissedDay === todaySeed)
    ? null
    : pickTriageCandidate(entries, resurfaced?.savedAt ?? null)

  return (
    <div className="tab-content">
      <div className="history-header">
        <span className="muted">{entries.length} clip{entries.length !== 1 ? 's' : ''}</span>
        <div className="history-header-actions">
          {somedayCount > 0 && (
            <button
              className={`someday-filter${showSomedayOnly ? ' active' : ''}`}
              onClick={() => setShowSomedayOnly(v => !v)}
            >
              🕒 Someday ({somedayCount})
            </button>
          )}
          <button className="btn-ghost small" onClick={handleClear}>Clear all</button>
        </div>
      </div>
      <div className="cite-style">
        <span className="cite-label">Cite as</span>
        {CITE_STYLES.map(s => (
          <button
            key={s.id}
            className={`cite-opt${citeStyle === s.id ? ' active' : ''}`}
            onClick={() => pickStyle(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <input
        className="history-search"
        type="search"
        placeholder="Search your clips…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      {resurfaced && (
        <>
          <div className="resurface-label">✨ Resurfaced</div>
          {clipCard(resurfaced, 'resurface', true)}
        </>
      )}

      {triageCandidate && triageCard(triageCandidate)}

      {filtered.length === 0 ? (
        <div className="muted history-empty-search">
          {showSomedayOnly
            ? (q ? `No Someday clips match "${query}".` : 'Nothing in Someday yet.')
            : (q ? `No clips match "${query}".` : 'Everything is tagged Someday — nice job triaging.')}
        </div>
      ) : (
        <div className="history-list">
          {visible.map((entry, i) => clipCard(entry, `${entry.savedAt}-${i}`))}
        </div>
      )}

      {filtered.length > visible.length && (
        <div className="muted history-more">Showing first {visible.length} of {filtered.length} — search to narrow.</div>
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
            <span className="privacy-icon">{item.ok ? '✓' : '✕'}</span>
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

// ── Root ──────────────────────────────────────────────────────────────────────
// Auth state lives here so the gate screen and the main UI are siblings.
// The drawer header reads userEmail from chrome.storage independently.

export function Popup() {
  const [tab, setTab] = useState<Tab>('docs')
  const [isSignedIn, setIsSignedIn] = useState(false)

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
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'docs' ? <DocsTab /> : <History />}
    </div>
  )
}
