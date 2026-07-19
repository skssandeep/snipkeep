import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import type {
  DocDestination,
  HistoryEntry,
  StartVoiceNoteMessage,
  StartVoiceNoteResponse,
  StopVoiceNoteMessage,
  VoiceNoteUpdateMessage,
  TeachBackMessage,
  TeachBackResponse,
  TeachBackResult,
  SyncPactMessage,
  SyncPactResponse,
} from '../types'
import { openDrawerFromPage } from './drawer'
import { upcomingSlots, nextSlotLabel, buildPactIcs } from '../lib/pact'
import { Outline } from './Outline'
import { Exam } from './Exam'

// One study record per clip (keyed by String(savedAt)), now carrying the
// spacing schedule. `interval`/`due` are absent on v1 entries (written before
// scheduling existed) — dueOf() migrates those lazily at read time, and the
// next grade rewrites the entry in the full shape. No migration pass needed.
interface StudyLogEntry {
  at: number
  result: 'got' | 'miss'
  interval?: number  // days
  due?: number       // epoch ms
}
type StudyLog = Record<string, StudyLogEntry>

const DAY_MS = 24 * 60 * 60 * 1000
// SM-2-lite ladder: "Got it" advances one step, "Not yet" resets to 1 day.
// Full SM-2's ease factors add tuning surface without evidence they'd matter
// at this scale.
const INTERVALS = [1, 3, 7, 14, 30, 60]
const SESSION_SIZE = 8   // deliberate (?doc=) sessions
const TODAY_SIZE = 5     // the daily due queue — done means done

// When is this clip's question due again? Never studied → due now (0).
// v1 entries (no `due`) get the lazy-migration rule: a past "got" behaves
// like a 3-day interval from when it happened, a "miss" like 1 day.
function dueOf(entry: StudyLogEntry | undefined): number {
  if (!entry) return 0
  if (entry.due !== undefined) return entry.due
  return entry.at + (entry.result === 'got' ? 3 : 1) * DAY_MS
}

// Miss → back to 1 day; got → the smallest ladder step above the current
// interval (so a fresh question's first "got" earns 1 day, then 3, 7, …).
function nextInterval(current: number | undefined, result: 'got' | 'miss'): number {
  if (result === 'miss') return 1
  const cur = current ?? 0
  return INTERVALS.find(i => i > cur) ?? INTERVALS[INTERVALS.length - 1]
}

// Deliberate-session order (unchanged from v1): misses first, then
// never-studied, then the stalest successes; oldest saved first within each.
function pickSession(clips: HistoryEntry[], log: StudyLog): HistoryEntry[] {
  const band = (c: HistoryEntry) => {
    const l = log[String(c.savedAt)]
    if (l?.result === 'miss') return 0
    if (!l) return 1
    return 2
  }
  return [...clips]
    .sort((a, b) => band(a) - band(b) || a.savedAt - b.savedAt)
    .slice(0, SESSION_SIZE)
}

// The Today queue: only what the schedule says is due, most-overdue first,
// hard-capped — spacing means the RIGHT five questions, not all of them.
function pickToday(clips: HistoryEntry[], log: StudyLog): HistoryEntry[] {
  const now = Date.now()
  return clips
    .filter(c => dueOf(log[String(c.savedAt)]) <= now)
    .sort((a, b) => dueOf(log[String(a.savedAt)]) - dueOf(log[String(b.savedAt)]))
    .slice(0, TODAY_SIZE)
}

// "2 questions come back tomorrow" / "… on Saturday" — information for the
// zero-due state, never pressure. Groups the earliest future due date's day.
function nextDueLine(clips: HistoryEntry[], log: StudyLog): string | null {
  const now = Date.now()
  const future = clips
    .map(c => dueOf(log[String(c.savedAt)]))
    .filter(d => d > now)
  if (future.length === 0) return null
  const min = Math.min(...future)
  const minDay = new Date(min).toDateString()
  const sameDay = future.filter(d => new Date(d).toDateString() === minDay).length
  const label =
    minDay === new Date(now).toDateString() ? 'later today'
    : minDay === new Date(now + DAY_MS).toDateString() ? 'tomorrow'
    : `on ${new Date(min).toLocaleDateString(undefined, { weekday: 'long' })}`
  return `${sameDay} question${sameDay !== 1 ? 's' : ''} come${sameDay === 1 ? 's' : ''} back ${label}`
}

type Phase = 'question' | 'answer'

// Navigating (not in-page state) keeps the URL the source of truth for what's
// being studied: the browser back button returns to Today for free.
function goToDoc(id: string) {
  window.location.search = `?doc=${encodeURIComponent(id)}`
}

export function Study() {
  // No params → the docs-first HOME (picker + a warm-up banner for what's due,
  // what the drawer's 💡 opens); ?today → the daily review queue; ?doc=all →
  // deliberate session across everything; ?doc=<id> → one doc. URL is the
  // source of truth so the browser back button always retraces the path.
  const params = new URLSearchParams(window.location.search)
  const examFor = params.get('exam')
  const docFilter = examFor ? null : params.get('doc')
  const today = !examFor && !docFilter && params.has('today')
  const isHome = !examFor && !docFilter && !today

  const [clips, setClips] = useState<HistoryEntry[]>([])
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [log, setLog] = useState<StudyLog>({})
  const [loaded, setLoaded] = useState(false)

  // Study Pact → Google Calendar: which docs have live synced events
  // (storage.local.pactCalendar, background-owned), which doc is mid-sync,
  // and a per-doc inline error from the last attempt.
  const [pactCalendar, setPactCalendar] = useState<Record<string, { eventIds: string[] }>>({})
  const [syncingPactFor, setSyncingPactFor] = useState<string | null>(null)
  const [pactSyncError, setPactSyncError] = useState<Record<string, string>>({})

  // The today queue is computed on every non-doc route: the ?today session
  // runs it, and the home banner shows its count. Frozen at mount.
  const [todayQueue, setTodayQueue] = useState<HistoryEntry[]>([])
  // The session is frozen at mount (not re-derived on storage changes) so a
  // question drafted mid-session can't reshuffle the deck under the student.
  const [session, setSession] = useState<HistoryEntry[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('question')
  const [attempt, setAttempt] = useState('')
  const [gotCount, setGotCount] = useState(0)
  const [mode, setMode] = useState<'study' | 'browse' | 'teach' | 'outline'>('study')

  // ── Teach-It-Back (Feynman mode) ──
  // Recognition itself runs in the voice tab (same pipeline as margin notes,
  // longForm tuning); this page only starts/stops it and consumes the
  // relayed transcript. Feature-detect here is valid — same browser.
  const [voiceSupported] = useState(
    () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  )
  const [teachPhase, setTeachPhase] = useState<'idle' | 'recording' | 'analyzing' | 'result'>('idle')
  const [transcript, setTranscript] = useState('')
  const [teachResult, setTeachResult] = useState<TeachBackResult | null>(null)
  const [teachError, setTeachError] = useState('')
  // Which result cards have revealed their source clip (keyed "m0"/"c2").
  const [teachRevealed, setTeachRevealed] = useState<Set<string>>(new Set())
  // Refs mirror state for the once-registered message listener (Toolbar's
  // pattern — the listener would otherwise close over stale values).
  const teachPhaseRef = useRef(teachPhase)
  useEffect(() => { teachPhaseRef.current = teachPhase }, [teachPhase])
  const transcriptRef = useRef('')
  const analyzeRef = useRef<() => void>(() => {})

  // 'unknown' until the first read so the connect hint can't flash before we
  // know; 'justConnected' is its own state so the page can acknowledge the
  // connect (and the backfill it triggers) instead of the hint just vanishing.
  const [aiState, setAiState] = useState<'unknown' | 'no' | 'yes' | 'justConnected'>('unknown')

  // The "caught up" banner is post-completion acknowledgement — dismissible,
  // per day. Stored as a date string so it returns naturally when tomorrow's
  // questions are actually due (then it's the actionable warm-up state anyway).
  const [warmupDismissed, setWarmupDismissed] = useState(false)

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if ('aiConfig' in changes) {
        setAiState(prev =>
          changes.aiConfig.newValue ? (prev === 'no' ? 'justConnected' : 'yes') : 'no'
        )
      }
      // Roles from CLASSIFY_ROLES (and questions from the backfill) land as
      // clips patches — refresh the card data live. The SESSION stays frozen
      // (its own state); only the source lists update.
      if ('clips' in changes) {
        const all = (changes.clips.newValue as HistoryEntry[]) ?? []
        setClips(all.filter(c => !docFilter || docFilter === 'all' || c.destinationId === docFilter))
      }
      if ('pactCalendar' in changes) {
        setPactCalendar((changes.pactCalendar.newValue as Record<string, { eventIds: string[] }>) ?? {})
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
    // docFilter comes from the URL — stable for this page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    Promise.all([
      chrome.storage.local.get(['clips', 'studyLog', 'aiConfig', 'studyWarmupDismissed', 'pactCalendar']),
      chrome.storage.sync.get(['docs']),
    ]).then(([local, sync]) => {
      setAiState(local.aiConfig ? 'yes' : 'no')
      setWarmupDismissed(local.studyWarmupDismissed === new Date().toDateString())
      setPactCalendar((local.pactCalendar as Record<string, { eventIds: string[] }>) ?? {})
      const allDocs = (sync.docs as DocDestination[]) ?? []
      const scopeId = examFor ?? docFilter
      const scoped = ((local.clips as HistoryEntry[]) ?? []).filter(
        c => !scopeId || scopeId === 'all' || c.destinationId === scopeId
      )
      const storedLog = (local.studyLog as StudyLog) ?? {}
      const questionClips = scoped.filter(c => c.retrievalQuestion)
      setClips(scoped)
      setDocs(allDocs)
      setLog(storedLog)
      if (docFilter) {
        setSession(pickSession(questionClips, storedLog))
        // A doc with clips but no questions yet lands in Browse — its library
        // is real even before the questions arrive; an empty session isn't.
        if (questionClips.length === 0 && scoped.length > 0) setMode('browse')
      } else {
        // Today's due queue, drawn from every non-completed project — used by
        // the ?today session AND the home's warm-up banner count.
        const doneIds = new Set(allDocs.filter(d => d.done).map(d => d.id))
        const eligible = questionClips.filter(c => !c.destinationId || !doneIds.has(c.destinationId))
        const queue = pickToday(eligible, storedLog)
        setTodayQueue(queue)
        if (today) setSession(queue)
      }
      setLoaded(true)
    })
  }, [docFilter, examFor])

  const docName = useMemo(() => {
    const id = examFor ?? docFilter
    if (!id || id === 'all') return 'All docs'
    return docs.find(d => d.id === id)?.name ?? 'This doc'
  }, [docFilter, examFor, docs])

  // Text clips only, in state order (newest first) — the background trims to
  // the first 40, and the AI's clipIndex refers into this same array, so the
  // reveal on result cards stays aligned with what the model actually saw.
  const teachClips = useMemo(() => clips.filter(c => c.kind !== 'image'), [clips])

  async function analyzeTeaching() {
    const text = transcriptRef.current.trim()
    if (text.length < 80) {
      setTeachError("That was short — try talking it through for a minute, like you're explaining to a friend.")
      setTeachPhase('idle')
      return
    }
    setTeachPhase('analyzing')
    setTeachError('')
    const msg: TeachBackMessage = {
      type: 'TEACH_BACK',
      payload: { destinationName: docName, transcript: text, clips: teachClips.map(c => c.text) },
    }
    const res: TeachBackResponse = await chrome.runtime.sendMessage(msg)
    if (res.success && res.result) {
      setTeachResult(res.result)
      setTeachRevealed(new Set())
      setTeachPhase('result')
    } else {
      setTeachError(res.error ?? 'Something went wrong — try again.')
      setTeachPhase('idle')
    }
  }
  // Refreshed every render so the once-registered listener below never calls
  // a stale closure (same handleSaveRef pattern as the toolbar's voice flow).
  useEffect(() => { analyzeRef.current = analyzeTeaching })

  // The voice tab's relay lands here (tabs.sendMessage → this tab, frame 0).
  useEffect(() => {
    function handleMessage(message: VoiceNoteUpdateMessage) {
      if (message.type !== 'VOICE_NOTE_UPDATE') return
      const { event } = message
      if (event.kind === 'transcript') {
        transcriptRef.current = event.text
        setTranscript(event.text)
      } else if (event.kind === 'error') {
        setTeachError(event.error)
        setTeachPhase('idle')
      } else if (teachPhaseRef.current === 'recording') {
        analyzeRef.current()
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  // Leaving teach mode (or the page) mid-recording must stop the mic — a
  // session with nothing left to receive its updates would keep listening
  // invisibly (same forgotten-mic rule as the toolbar's note panel).
  useEffect(() => {
    if (mode !== 'teach' && teachPhaseRef.current === 'recording') {
      chrome.runtime.sendMessage({ type: 'STOP_VOICE_NOTE' } satisfies StopVoiceNoteMessage)
      setTeachPhase('idle')
    }
  }, [mode])
  useEffect(() => () => {
    if (teachPhaseRef.current === 'recording') {
      chrome.runtime.sendMessage({ type: 'STOP_VOICE_NOTE' } satisfies StopVoiceNoteMessage)
    }
  }, [])

  async function startTeaching() {
    setTranscript('')
    transcriptRef.current = ''
    setTeachError('')
    setTeachResult(null)
    const res: StartVoiceNoteResponse = await chrome.runtime.sendMessage(
      { type: 'START_VOICE_NOTE', payload: { longForm: true } } satisfies StartVoiceNoteMessage
    )
    if (res?.success) setTeachPhase('recording')
    else setTeachError(res?.error ?? 'Could not start the microphone.')
  }

  // Picker rows: every non-done doc that has clips at all — hiding docs
  // without questions made the library look empty ("where are my docs?").
  // On Today it renders below the done/empty state as the deliberate path.
  const pickerDocs = useMemo(() => {
    if (docFilter) return []
    return docs
      .filter(d => !d.done)
      .map(d => {
        const docClips = clips.filter(c => c.destinationId === d.id)
        return {
          doc: d,
          clipCount: docClips.length,
          questionCount: docClips.filter(c => c.retrievalQuestion).length,
          textCount: docClips.filter(c => c.kind !== 'image').length,
        }
      })
      .filter(x => x.clipCount > 0)
  }, [docFilter, docs, clips])

  // Knowledge Heat: collected vs recalled per doc — the honesty dashboard.
  // "Recalled" = clips whose latest self-grade is 'got' (the studyLog holds
  // latest-only, which is the honest read: what you can produce NOW). Pure
  // presentation — no AI, no storage, computed from data already loaded.
  const heatRows = useMemo(() => {
    if (!isHome) return []
    return docs
      .filter(d => !d.done)
      .map(d => {
        const docClips = clips.filter(c => c.destinationId === d.id)
        return {
          doc: d,
          collected: docClips.length,
          recalled: docClips.filter(c => log[String(c.savedAt)]?.result === 'got').length,
        }
      })
      .filter(x => x.collected > 0)
  }, [isHome, docs, clips, log])

  const current = session[index]
  const done = loaded && (index >= session.length) && session.length > 0

  // A new user has clips but no AI key: without this, the picker is a wall of
  // "no questions yet" with no explanation and no way out.
  const connectHint =
    aiState === 'no' ? (
      <div className="study-hint">
        <p>
          Questions are drafted by your own AI key — SnipKeep never sees it.
          Connect one and every clip you've saved, past and future, gets a
          practice question automatically.
        </p>
        <button className="study-secondary" onClick={() => openDrawerFromPage('ai')}>
          Connect your AI key
        </button>
      </div>
    ) : aiState === 'justConnected' ? (
      <div className="study-hint">
        <p>Connected — questions are being drafted for your clips right now. Check back in a minute.</p>
      </div>
    ) : null

  // Study Pact → Google Calendar: explicit button, always interactive (may
  // show the Google consent/account prompt — the first sync after this
  // feature shipped needs it even for already-signed-in users, since the
  // manifest's OAuth scope grew). Toggles off by deleting the doc's events.
  async function togglePactCalendar(doc: DocDestination) {
    const wasOn = !!pactCalendar[doc.id]
    setSyncingPactFor(doc.id)
    setPactSyncError(prev => { const next = { ...prev }; delete next[doc.id]; return next })
    const msg: SyncPactMessage = {
      type: 'SYNC_PACT',
      payload: { destinationId: doc.id, destinationName: doc.name, enabled: !wasOn, interactive: true },
    }
    const res: SyncPactResponse = await chrome.runtime.sendMessage(msg)
    setSyncingPactFor(null)
    if (!res.success) {
      setPactSyncError(prev => ({ ...prev, [doc.id]: res.error ?? 'Approve calendar access and try again.' }))
    }
  }

  async function grade(result: 'got' | 'miss') {
    if (!current) return
    const key = String(current.savedAt)
    const at = Date.now()
    const interval = nextInterval(log[key]?.interval, result)
    const entry: StudyLogEntry = { at, result, interval, due: at + interval * DAY_MS }
    setLog(prev => ({ ...prev, [key]: entry }))
    // Fresh-read merge like the background's clip patches — another study tab
    // may have written since we loaded.
    const stored = await chrome.storage.local.get(['studyLog'])
    const freshLog = { ...((stored.studyLog as StudyLog) ?? {}), [key]: entry }
    await chrome.storage.local.set({ studyLog: freshLog })
    if (result === 'got') setGotCount(n => n + 1)
    setAttempt('')
    setPhase('question')
    setIndex(i => i + 1)
  }

  if (!loaded) return null

  // The doc list (the home's primary content).
  const pickerRows = pickerDocs.length > 0 && (
    <div className="study-pick-list">
      {pickerDocs.map(({ doc, clipCount, questionCount, textCount }) => (
        <div key={doc.id} className="study-pick-group">
          <button className="study-pick-card" onClick={() => goToDoc(doc.id)}>
            <span className="study-pick-name">{doc.name}</span>
            <span className="study-pick-count">
              {questionCount > 0
                ? `${questionCount} question${questionCount !== 1 ? 's' : ''} ready`
                : `${clipCount} clip${clipCount !== 1 ? 's' : ''} · no questions yet`}
            </span>
          </button>
          {/* Exam Forge: appears exactly when exam prep is real — a deadline
              exists, there's enough material, and a key can build it. A
              SIBLING of the card button, never nested. */}
          {doc.dueDate && textCount >= 3 && aiState === 'yes' && (
            <button
              className="study-forge-row"
              onClick={() => { window.location.search = `?exam=${encodeURIComponent(doc.id)}` }}
            >
              ⚒ Forge a practice exam
            </button>
          )}
          {/* Study Pact: the next slot with its live share of the load —
              due questions ÷ remaining slots, so a missed slot silently
              redistributes. Plus the .ics snapshot (the in-app line is the
              live truth; a downloaded calendar can't self-update). */}
          {doc.pact && doc.dueDate && (() => {
            const label = nextSlotLabel(doc.pact, doc.dueDate)
            if (!label) return null
            const slots = upcomingSlots(doc.pact, doc.dueDate)
            const due = clips.filter(
              c => c.destinationId === doc.id && c.retrievalQuestion &&
                dueOf(log[String(c.savedAt)]) <= Date.now()
            ).length
            const perSlot = slots.length > 0 ? Math.max(1, Math.ceil(due / slots.length)) : 0
            const isSynced = !!pactCalendar[doc.id]
            const isSyncing = syncingPactFor === doc.id
            const syncError = pactSyncError[doc.id]
            return (
              <div className="study-pact-row">
                <button className="study-pact-next" onClick={() => goToDoc(doc.id)}>
                  📅 Next: {label}{due > 0 ? ` · ~${perSlot} question${perSlot !== 1 ? 's' : ''} (~${Math.max(1, Math.round(perSlot * 1.5))} min)` : ''}
                </button>
                <button
                  className={`study-pact-cal${isSynced ? ' on' : ''}`}
                  disabled={isSyncing}
                  onClick={() => togglePactCalendar(doc)}
                  title={isSynced ? 'Turn off Google Calendar reminders for this plan' : 'Get a Google Calendar event + reminder for every upcoming slot, on every device'}
                >
                  {isSyncing ? 'Setting up…' : isSynced ? '🔔 Reminders on' : '🔔 Remind me in Google Calendar'}
                </button>
                <button
                  className="study-pact-ics"
                  onClick={() => {
                    const ics = buildPactIcs(doc.name, slots)
                    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `snipkeep-${doc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-plan.ics`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  title="Download the remaining slots as calendar events (a snapshot — this line stays the live plan)"
                >
                  Add to calendar
                </button>
                {syncError && <span className="study-pact-cal-error">{syncError}</span>}
              </div>
            )
          })()}
        </div>
      ))}
      {pickerDocs.filter(x => x.questionCount > 0).length > 1 && (
        <button className="study-pick-card all" onClick={() => goToDoc('all')}>
          <span className="study-pick-name">Everything</span>
          <span className="study-pick-count">
            {pickerDocs.reduce((n, x) => n + x.questionCount, 0)} questions across your docs
          </span>
        </button>
      )}
    </div>
  )

  // The warm-up banner: the daily review reframed as an optional light round
  // before focused doc study, not a takeover. Three states — due, caught-up,
  // or absent (no scheduled questions at all).
  const dueCount = todayQueue.length
  const anyScheduled = clips.some(c => c.retrievalQuestion)
  const warmupBanner = dueCount > 0 ? (
    <button className="study-warmup" onClick={() => { window.location.search = '?today' }}>
      <span className="study-warmup-main">
        <span className="study-warmup-sun" aria-hidden="true">☀</span>
        Warm up · {dueCount} resurfaced today · ~{Math.max(1, Math.round(dueCount * 0.4))} min
      </span>
      <span className="study-warmup-go" aria-hidden="true">▶</span>
    </button>
  ) : anyScheduled && !warmupDismissed ? (
    <div className="study-warmup caught-up">
      <span className="study-warmup-main">
        <span className="study-warmup-check" aria-hidden="true">✓</span>
        You're caught up — {nextDueLine(clips.filter(c => c.retrievalQuestion), log) ?? 'nothing due right now'}
      </span>
      <button
        className="study-warmup-close"
        aria-label="Dismiss"
        onClick={() => {
          setWarmupDismissed(true)
          chrome.storage.local.set({ studyWarmupDismissed: new Date().toDateString() })
        }}
      >
        ✕
      </button>
    </div>
  ) : null

  // Shared question → attempt → reveal → grade flow (Today and deliberate).
  const sessionFlow = current && (
    <main className="study-main center">
      <p className="study-progress">
        {today ? 'Today · ' : ''}{index + 1} of {session.length}
      </p>
      <h1 className="study-question">{current.retrievalQuestion}</h1>

      {phase === 'question' ? (
        <>
          {/* Typing an attempt is optional but rewarded — producing an answer
              (generation effect) beats silently recognizing one. Enter
              reveals; Shift+Enter for a newline. */}
          <textarea
            className="study-attempt"
            placeholder="Type what you remember… (optional)"
            value={attempt}
            onChange={e => setAttempt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                setPhase('answer')
              }
            }}
            autoFocus
          />
          <button className="study-primary" onClick={() => setPhase('answer')}>
            Show the clip
          </button>
        </>
      ) : (
        <>
          {attempt.trim() && <p className="study-attempt-echo">{attempt}</p>}
          <div className="study-answer">
            <p className="study-answer-text">{current.text}</p>
            {current.note && <p className="study-answer-note">{current.note}</p>}
            <p className="study-answer-meta">
              <a href={current.sourceUrl} target="_blank" rel="noreferrer">{current.sourceTitle}</a>
            </p>
          </div>
          <div className="study-grade">
            {/* Self-graded on purpose: judging your own recall is itself a
                metacognitive rep. "Not yet" — never "wrong." */}
            <button className="study-secondary" onClick={() => grade('miss')}>Not yet</button>
            <button className="study-primary" onClick={() => grade('got')}>Got it</button>
          </div>
        </>
      )}
    </main>
  )

  return (
    <div className="study-page">
      <header className="study-header">
        {/* Logo → home (the docs picker). href to the bare pathname strips the
            query, so it lands on the no-params home from any route. */}
        <a className="study-wordmark" href={window.location.pathname} title="SnipKeep home">
          <span className="study-logo" aria-hidden="true"><Bookmark size={15} strokeWidth={2.5} /></span>
          Snip<b>Keep</b>
        </a>
        {(docFilter || examFor) && <span className="study-doc-name">{docName}</span>}
        {examFor && (
          <nav className="study-modes">
            <button className="study-mode" onClick={() => { window.location.search = '' }}>
              ← Docs
            </button>
          </nav>
        )}
        {docFilter && (
          <nav className="study-modes">
            <button
              className={`study-mode${mode === 'study' ? ' on' : ''}`}
              onClick={() => setMode('study')}
            >
              Study
            </button>
            <button
              className={`study-mode${mode === 'browse' ? ' on' : ''}`}
              onClick={() => setMode('browse')}
            >
              Browse
            </button>
            {/* Invisible-until-real, like every AI surface: needs a key, a
                mic-capable browser, and actual clips to compare against. */}
            {aiState === 'yes' && voiceSupported && teachClips.length > 0 && (
              <button
                className={`study-mode${mode === 'teach' ? ' on' : ''}`}
                onClick={() => setMode('teach')}
              >
                Teach
              </button>
            )}
            {docFilter !== 'all' && clips.length > 0 && (
              <button
                className={`study-mode${mode === 'outline' ? ' on' : ''}`}
                onClick={() => setMode('outline')}
              >
                Outline
              </button>
            )}
          </nav>
        )}
        {/* On the review, one way back to the docs home. */}
        {today && (
          <nav className="study-modes">
            <button className="study-mode" onClick={() => { window.location.search = '' }}>
              ← Docs
            </button>
          </nav>
        )}
      </header>

      {isHome ? (
        <main className="study-main center">
          {warmupBanner}
          {pickerDocs.length === 0 ? (
            <p className="study-empty">
              Nothing saved yet.<br />
              Clip a few things first — each doc will show up here.
            </p>
          ) : (
            <>
              <h1 className="study-pick-title">What are you studying?</h1>
              {pickerRows}
            </>
          )}
          {heatRows.length > 0 && (
            <section className="heat">
              <h2 className="ol-zone-title">How solid is it?</h2>
              {heatRows.map(({ doc, collected, recalled }) => {
                const gap = collected >= 10 && recalled / collected < 0.2
                return (
                  <button key={doc.id} className="heat-row" onClick={() => goToDoc(doc.id)}>
                    <span className="heat-name">{doc.name}</span>
                    <span className="heat-bars" aria-hidden="true">
                      <span className="heat-bar heat-bar-collected" style={{ width: '100%' }} />
                      <span
                        className="heat-bar heat-bar-recalled"
                        style={{ width: `${collected ? Math.max((recalled / collected) * 100, recalled > 0 ? 3 : 0) : 0}%` }}
                      />
                    </span>
                    <span className="heat-legend">
                      {collected} collected · {recalled} recalled
                    </span>
                    {/* Information, never accusation — and silence when the
                        ratio is healthy. */}
                    {gap && (
                      <span className="heat-gap">
                        You've saved {collected} clips here and recalled {recalled} — this topic may
                        feel more known than it is.
                      </span>
                    )}
                  </button>
                )
              })}
            </section>
          )}
          {connectHint}
        </main>
      ) : today ? (
        done ? (
          <main className="study-main center">
            {/* A hard, calm stop — no "keep going?", no infinite feed. */}
            <p className="study-done-big">That's today's review.</p>
            <p className="study-done-sub">
              {gotCount} recalled · {session.length - gotCount} come back tomorrow
            </p>
            <button className="study-secondary" onClick={() => { window.location.search = '' }}>
              ← Back to docs
            </button>
          </main>
        ) : session.length > 0 ? (
          sessionFlow
        ) : (
          <main className="study-main center">
            {anyScheduled ? (
              <>
                <p className="study-done-big">Nothing due today.</p>
                {(() => {
                  const line = nextDueLine(clips.filter(c => c.retrievalQuestion), log)
                  return line ? <p className="study-next-due">{line}</p> : null
                })()}
              </>
            ) : (
              <p className="study-empty">
                No questions anywhere yet.<br />
                Save a few clips with an AI provider connected and they'll each
                arrive with a question to practice on.
              </p>
            )}
            <button className="study-secondary" onClick={() => { window.location.search = '' }}>
              ← Back to docs
            </button>
          </main>
        )
      ) : examFor ? (
        <Exam clips={clips} destinationId={examFor} destinationName={docName} />
      ) : mode === 'outline' && docFilter ? (
        <main className="study-main outline">
          <Outline clips={clips} destinationId={docFilter} aiConnected={aiState === 'yes'} />
        </main>
      ) : mode === 'teach' ? (
        <main className="study-main center">
          {teachPhase === 'idle' && (
            <>
              <h1 className="study-question">Explain {docName} out loud, from memory.</h1>
              <p className="teach-sub">
                Talk like you're teaching a friend. When you stop, your own AI
                checks what you covered against your clips — it points at gaps,
                it never explains for you.
              </p>
              {teachError && <p className="teach-error">{teachError}</p>}
              <button className="teach-mic" onClick={startTeaching} aria-label="Start explaining">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
                </svg>
              </button>
            </>
          )}

          {teachPhase === 'recording' && (
            <>
              <p className="study-progress teach-live"><span className="teach-dot" aria-hidden="true" /> Listening — take your time</p>
              <p className={`teach-transcript${transcript ? '' : ' empty'}`}>
                {transcript || 'Start talking whenever you\'re ready…'}
              </p>
              <button
                className="study-primary"
                onClick={() => chrome.runtime.sendMessage({ type: 'STOP_VOICE_NOTE' } satisfies StopVoiceNoteMessage)}
              >
                Done
              </button>
            </>
          )}

          {teachPhase === 'analyzing' && (
            <p className="study-done-big">Comparing against your clips…</p>
          )}

          {teachPhase === 'result' && teachResult && (
            <>
              {teachResult.covered.length > 0 && (
                <section className="teach-group">
                  <h2 className="teach-group-title">✓ You covered</h2>
                  <div className="teach-chips">
                    {teachResult.covered.map((c, i) => (
                      <span key={i} className="teach-chip">{c}</span>
                    ))}
                  </div>
                </section>
              )}

              {teachResult.missing.length > 0 && (
                <section className="teach-group">
                  <h2 className="teach-group-title">? You didn't mention</h2>
                  {teachResult.missing.map((m, i) => {
                    const key = `m${i}`
                    const clip = teachClips[m.clipIndex]
                    const open = teachRevealed.has(key)
                    const toggle = () =>
                      setTeachRevealed(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    return (
                      <div key={key} className="study-answer">
                        <p className="study-answer-text">{m.question}</p>
                        {clip && (
                          <>
                            {open && <p className="teach-source">{clip.text}</p>}
                            <button className="teach-reveal" onClick={toggle} aria-expanded={open}>
                              {open ? 'Hide the clip ↑' : 'Show the clip ↓'}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </section>
              )}

              {teachResult.conflicting.length > 0 && (
                <section className="teach-group">
                  <h2 className="teach-group-title">⚠ Check this</h2>
                  {teachResult.conflicting.map((c, i) => {
                    const clip = teachClips[c.clipIndex]
                    return (
                      <div key={i} className="study-answer">
                        <p className="teach-said">You said: “{c.said}”</p>
                        {clip && <p className="teach-source">Your clip: {clip.text}</p>}
                      </div>
                    )
                  })}
                </section>
              )}

              {teachResult.covered.length === 0 &&
                teachResult.missing.length === 0 &&
                teachResult.conflicting.length === 0 && (
                  <p className="study-empty">Nothing to flag — try a longer explanation for a sharper check.</p>
                )}

              <button className="study-secondary" onClick={() => { setTeachPhase('idle'); setTranscript(''); transcriptRef.current = '' }}>
                Teach it again
              </button>
            </>
          )}
        </main>
      ) : mode === 'browse' ? (
        <main className="study-main browse">
          {session.length === 0 && connectHint}
          {clips.length === 0 ? (
            <p className="study-empty">Nothing saved here yet.</p>
          ) : (
            clips.map(c => (
              <article key={c.savedAt} className="browse-card">
                <p className="browse-text">{c.text}</p>
                {c.note && <p className="browse-note">{c.note}</p>}
                <p className="browse-meta">
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.sourceTitle}</a>
                </p>
              </article>
            ))
          )}
        </main>
      ) : session.length === 0 ? (
        <main className="study-main center">
          <p className="study-empty">
            No questions here yet.<br />
            Save a few clips with an AI provider connected and they'll each
            arrive with a question to practice on.
          </p>
        </main>
      ) : done ? (
        <main className="study-main center">
          <p className="study-done-big">That's the session.</p>
          <p className="study-done-sub">
            {gotCount} recalled · {session.length - gotCount} will come back next time
          </p>
          <button className="study-secondary" onClick={() => setMode('browse')}>
            Browse the clips
          </button>
        </main>
      ) : (
        sessionFlow
      )}
    </div>
  )
}
