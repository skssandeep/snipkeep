import { useEffect, useMemo, useState } from 'react'
import type { DocDestination, HistoryEntry } from '../types'
import { openDrawerFromPage } from './drawer'

// One study attempt's latest outcome per clip (keyed by String(savedAt)).
// Deliberately tiny — Phase 2 (spaced scheduling) can grow richer state, but
// v1 only needs "was this missed last time?" to put misses first next session.
interface StudyLogEntry {
  at: number
  result: 'got' | 'miss'
}
type StudyLog = Record<string, StudyLogEntry>

const SESSION_SIZE = 8

// Misses first (they earned another attempt), then never-studied, then the
// stalest successes. Within each band, oldest saved first — older material is
// closest to being forgotten, so it needs retrieval most (spacing logic in
// miniature, ahead of real scheduling in Phase 2).
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

type Phase = 'question' | 'answer'

// Navigating (not in-page state) keeps the URL the source of truth for what's
// being studied: the browser back button returns to the picker for free.
function goToDoc(id: string) {
  window.location.search = `?doc=${encodeURIComponent(id)}`
}

export function Study() {
  // No ?doc → the picker ("choose what to study"); ?doc=all → everything;
  // ?doc=<id> → that one doc.
  const docFilter = new URLSearchParams(window.location.search).get('doc')

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
      const scoped = ((local.clips as HistoryEntry[]) ?? []).filter(
        c => !docFilter || docFilter === 'all' || c.destinationId === docFilter
      )
      const storedLog = (local.studyLog as StudyLog) ?? {}
      const questionClips = scoped.filter(c => c.retrievalQuestion)
      setClips(scoped)
      setDocs((sync.docs as DocDestination[]) ?? [])
      setLog(storedLog)
      setSession(pickSession(questionClips, storedLog))
      // A doc with clips but no questions yet lands in Browse — its library is
      // real even before the questions arrive; an empty study session isn't.
      if (docFilter && questionClips.length === 0 && scoped.length > 0) setMode('browse')
      setLoaded(true)
    })
  }, [docFilter])

  const docName = useMemo(() => {
    if (!docFilter || docFilter === 'all') return 'All docs'
    return docs.find(d => d.id === docFilter)?.name ?? 'This doc'
  }, [docFilter, docs])

  // Picker rows: every non-done doc that has clips at all — hiding docs
  // without questions made the library look empty ("where are my docs?").
  // Docs with questions lead with "N questions ready" (the session was
  // prepared before you arrived — the zero-setup bet); docs without open in
  // Browse and say so honestly, never a dead-end empty session.
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
  // "no questions yet" with no explanation and no way out. The hint names the
  // one-time setup and its full payoff (the backfill covers past clips too);
  // after connecting, it acknowledges the work now happening instead of
  // silently disappearing.
  const connectHint =
    aiState === 'no' ? (
      <div className="study-hint">
        <p>
          Questions are drafted by your own AI key — SnipKeep never sees it.
          Connect one and every clip you've saved, past and future, gets a
          practice question automatically.
        </p>
        <button className="study-secondary" onClick={openDrawerFromPage}>
          Open the drawer → tap ✨ AI
        </button>
      </div>
    ) : aiState === 'justConnected' ? (
      <div className="study-hint">
        <p>Connected — questions are being drafted for your clips right now. Check back in a minute.</p>
      </div>
    ) : null

  async function grade(result: 'got' | 'miss') {
    if (!current) return
    const next: StudyLog = { ...log, [String(current.savedAt)]: { at: Date.now(), result } }
    setLog(next)
    // Fresh-read merge like the background's clip patches — another study tab
    // (or a future scheduler) may have written since we loaded.
    const stored = await chrome.storage.local.get(['studyLog'])
    const freshLog = { ...((stored.studyLog as StudyLog) ?? {}), [String(current.savedAt)]: next[String(current.savedAt)] }
    await chrome.storage.local.set({ studyLog: freshLog })
    if (result === 'got') setGotCount(n => n + 1)
    setAttempt('')
    setPhase('question')
    setIndex(i => i + 1)
  }

  if (!loaded) return null

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
      </header>

      {!docFilter ? (
        <main className="study-main center">
          {pickerDocs.length === 0 ? (
            <p className="study-empty">
              No questions anywhere yet.<br />
              Save a few clips with an AI provider connected (drawer → ✨ AI) and
              they'll each arrive with a question to practice on.
            </p>
          ) : (
            <>
              <h1 className="study-pick-title">What are you studying?</h1>
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
              {connectHint}
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
            Save a few clips with an AI provider connected (drawer → ✨ AI) and
            they'll each arrive with a question to practice on.
          </p>
        </main>
      ) : done ? (
        <main className="study-main center">
          {/* A hard, calm stop — no "keep going?", no infinite feed. Ending
              with appetite left is what makes the next session happen. */}
          <p className="study-done-big">That's the session.</p>
          <p className="study-done-sub">
            {gotCount} recalled · {session.length - gotCount} will come back next time
          </p>
          <button className="study-secondary" onClick={() => setMode('browse')}>
            Browse the clips
          </button>
        </main>
      ) : (
        <main className="study-main center">
          <p className="study-progress">{index + 1} of {session.length}</p>
          <h1 className="study-question">{current.retrievalQuestion}</h1>

          {phase === 'question' ? (
            <>
              {/* Typing an attempt is optional but rewarded — producing an
                  answer (generation effect) beats silently recognizing one.
                  Enter reveals; Shift+Enter for a newline, same convention as
                  the toolbar's note field. */}
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
      )}
    </div>
  )
}
