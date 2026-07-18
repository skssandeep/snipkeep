import { useEffect, useMemo, useState } from 'react'
import type { DocDestination, HistoryEntry } from '../types'
import { openDrawerFromPage } from './drawer'

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
  // No ?doc → Today (the daily due queue, what the drawer's 💡 opens);
  // ?choose → the standalone doc picker; ?doc=all → deliberate session
  // across everything; ?doc=<id> → one doc. URL is the source of truth so
  // the browser back button always retraces the path.
  const params = new URLSearchParams(window.location.search)
  const docFilter = params.get('doc')
  const choosing = !docFilter && params.has('choose')

  const [clips, setClips] = useState<HistoryEntry[]>([])
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [log, setLog] = useState<StudyLog>({})
  const [loaded, setLoaded] = useState(false)

  // The session is frozen at mount (not re-derived on storage changes) so a
  // question drafted mid-session can't reshuffle the deck under the student.
  const [session, setSession] = useState<HistoryEntry[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('question')
  const [attempt, setAttempt] = useState('')
  const [gotCount, setGotCount] = useState(0)
  const [mode, setMode] = useState<'study' | 'browse'>('study')

  // 'unknown' until the first read so the connect hint can't flash before we
  // know; 'justConnected' is its own state so the page can acknowledge the
  // connect (and the backfill it triggers) instead of the hint just vanishing.
  const [aiState, setAiState] = useState<'unknown' | 'no' | 'yes' | 'justConnected'>('unknown')

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !('aiConfig' in changes)) return
      setAiState(prev =>
        changes.aiConfig.newValue ? (prev === 'no' ? 'justConnected' : 'yes') : 'no'
      )
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  useEffect(() => {
    Promise.all([
      chrome.storage.local.get(['clips', 'studyLog', 'aiConfig']),
      chrome.storage.sync.get(['docs']),
    ]).then(([local, sync]) => {
      setAiState(local.aiConfig ? 'yes' : 'no')
      const allDocs = (sync.docs as DocDestination[]) ?? []
      const scoped = ((local.clips as HistoryEntry[]) ?? []).filter(
        c => !docFilter || docFilter === 'all' || c.destinationId === docFilter
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
        // Today: due questions only, and never from completed projects.
        const doneIds = new Set(allDocs.filter(d => d.done).map(d => d.id))
        const eligible = questionClips.filter(c => !c.destinationId || !doneIds.has(c.destinationId))
        setSession(pickToday(eligible, storedLog))
      }
      setLoaded(true)
    })
  }, [docFilter])

  const docName = useMemo(() => {
    if (!docFilter || docFilter === 'all') return 'All docs'
    return docs.find(d => d.id === docFilter)?.name ?? 'This doc'
  }, [docFilter, docs])

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
        }
      })
      .filter(x => x.clipCount > 0)
  }, [docFilter, docs, clips])

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

  const isToday = !docFilter && !choosing

  // The doc list, shared by the standalone picker (?choose) and the "or
  // study one doc" block under Today's done/empty states.
  const pickerRows = pickerDocs.length > 0 && (
    <div className="study-pick-list">
      {pickerDocs.map(({ doc, clipCount, questionCount }) => (
        <button key={doc.id} className="study-pick-card" onClick={() => goToDoc(doc.id)}>
          <span className="study-pick-name">{doc.name}</span>
          <span className="study-pick-count">
            {questionCount > 0
              ? `${questionCount} question${questionCount !== 1 ? 's' : ''} ready`
              : `${clipCount} clip${clipCount !== 1 ? 's' : ''} · no questions yet`}
          </span>
        </button>
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

  const pickerBlock = pickerRows && (
    <>
      <h2 className="study-pick-subtitle">Or study one doc</h2>
      {pickerRows}
    </>
  )

  // Shared question → attempt → reveal → grade flow (Today and deliberate).
  const sessionFlow = current && (
    <main className="study-main center">
      <p className="study-progress">
        {isToday ? 'Today · ' : ''}{index + 1} of {session.length}
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
        <span className="study-wordmark">Snip<b>Keep</b></span>
        {docFilter && <span className="study-doc-name">{docName}</span>}
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
          </nav>
        )}
        {/* Today buried the doc-wise path (it only surfaced after the session
            ended) — this keeps it one quiet click away at all times. */}
        {isToday && (
          <nav className="study-modes">
            <button className="study-mode" onClick={() => { window.location.search = '?choose' }}>
              Choose a doc
            </button>
          </nav>
        )}
      </header>

      {choosing ? (
        <main className="study-main center">
          {pickerDocs.length === 0 ? (
            <>
              <p className="study-empty">
                Nothing saved yet.<br />
                Clip a few things first — each doc will show up here.
              </p>
              {connectHint}
            </>
          ) : (
            <>
              <h1 className="study-pick-title">What are you studying?</h1>
              {pickerRows}
              {connectHint}
            </>
          )}
        </main>
      ) : isToday ? (
        done ? (
          <main className="study-main center">
            {/* A hard, calm stop — no "keep going?", no infinite feed. */}
            <p className="study-done-big">That's today's review.</p>
            <p className="study-done-sub">
              {gotCount} recalled · {session.length - gotCount} come back tomorrow
            </p>
            {pickerBlock}
          </main>
        ) : session.length > 0 ? (
          sessionFlow
        ) : (
          <main className="study-main center">
            {clips.some(c => c.retrievalQuestion) ? (
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
            {pickerBlock}
            {connectHint}
          </main>
        )
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
