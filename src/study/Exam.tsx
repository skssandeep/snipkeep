import { useEffect, useRef, useState } from 'react'
import type {
  HistoryEntry,
  ExamKind,
  ExamFormat,
  ExamVerdict,
  ForgeExamMessage,
  ForgeExamResponse,
  CheckExamMessage,
  CheckExamResponse,
} from '../types'

// Exam Forge (feature research PDF #08): a practice test forged fresh from
// one doc's clips, sat one question at a time, then CLASSIFIED (never graded)
// against the source clips. Ephemeral by design — nothing is stored, every
// sitting builds a new exam.

interface ExamQuestion {
  question: string
  kind: ExamKind
  sourceSavedAt: number
  options?: string[]
  correctIndex?: number
}

const KIND_LABEL: Record<ExamKind, string> = {
  recall: 'Recall',
  application: 'Apply',
  why: 'Why',
}

const VERDICT_META: Record<ExamVerdict, { label: string; glyph: string }> = {
  covered: { label: 'Covered', glyph: '✓' },
  missed: { label: 'Revisit', glyph: '○' },
  conflicting: { label: 'Check this', glyph: '⚠' },
}

interface Props {
  clips: HistoryEntry[]
  destinationId: string
  destinationName: string
}

export function Exam({ clips, destinationId, destinationName }: Props) {
  const byId = new Map(clips.map(c => [c.savedAt, c]))

  // 'choose' first: written answers work memory harder (production beats
  // recognition), MCQs are faster and friendlier — the student picks per
  // sitting, with the tradeoff stated plainly.
  const [phase, setPhase] = useState<'choose' | 'forging' | 'exam' | 'checking' | 'report' | 'error'>('choose')
  const [format, setFormat] = useState<ExamFormat>('written')
  const [choice, setChoice] = useState<number | null>(null)
  const [mcqChoices, setMcqChoices] = useState<(number | null)[]>([])
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [verdicts, setVerdicts] = useState<ExamVerdict[]>([])
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)

  async function forge(fmt: ExamFormat) {
    setFormat(fmt)
    setPhase('forging')
    setError('')
    setQuestions([])
    setAnswers([])
    setMcqChoices([])
    setChoice(null)
    setIndex(0)
    setDraft('')
    setVerdicts([])
    setRevealed(new Set())
    const msg: ForgeExamMessage = { type: 'FORGE_EXAM', payload: { destinationId, destinationName, format: fmt } }
    const res: ForgeExamResponse = await chrome.runtime.sendMessage(msg)
    if (res?.success && res.questions?.length) {
      setQuestions(res.questions)
      setPhase('exam')
    } else {
      setError(res?.error ?? 'Could not build the exam')
      setPhase('error')
    }
  }
  useEffect(() => {
    if (phase === 'exam') inputRef.current?.focus()
  }, [phase, index])

  async function next() {
    // MCQ: verdicts are objective and local — correct option = covered,
    // wrong = conflicting (your pick disagrees with your clip), skip = missed.
    if (format === 'mcq') {
      const picks = [...mcqChoices, choice]
      setMcqChoices(picks)
      setAnswers([...answers, choice !== null ? questions[index].options?.[choice] ?? '' : ''])
      setChoice(null)
      if (index + 1 < questions.length) {
        setIndex(index + 1)
        return
      }
      setVerdicts(questions.map((q, i) => {
        const pick = picks[i]
        if (pick === null || pick === undefined) return 'missed'
        return pick === q.correctIndex ? 'covered' : 'conflicting'
      }))
      setPhase('report')
      return
    }

    const finished = [...answers, draft.trim()]
    setAnswers(finished)
    setDraft('')
    if (index + 1 < questions.length) {
      setIndex(index + 1)
      return
    }
    // Last answer in — check. Empty answers are pre-classified 'missed'
    // locally; only real attempts go to the AI.
    setPhase('checking')
    const attempted = questions
      .map((q, i) => ({ q, i, answer: finished[i] }))
      .filter(x => x.answer.length > 0)
    let aiVerdicts: ExamVerdict[] = []
    if (attempted.length > 0) {
      const msg: CheckExamMessage = {
        type: 'CHECK_EXAM',
        payload: {
          items: attempted.map(x => ({
            question: x.q.question,
            answer: x.answer,
            sourceSavedAt: x.q.sourceSavedAt,
          })),
        },
      }
      const res: CheckExamResponse = await chrome.runtime.sendMessage(msg)
      if (!res?.success || !res.verdicts) {
        setError(res?.error ?? 'Could not check your answers')
        setPhase('error')
        return
      }
      aiVerdicts = res.verdicts
    }
    const all: ExamVerdict[] = questions.map((_, i) => {
      if (finished[i].length === 0) return 'missed'
      const pos = attempted.findIndex(x => x.i === i)
      return aiVerdicts[pos] ?? 'missed'
    })
    setVerdicts(all)
    setPhase('report')
  }

  const current = questions[index]
  const counts = {
    covered: verdicts.filter(v => v === 'covered').length,
    missed: verdicts.filter(v => v === 'missed').length,
    conflicting: verdicts.filter(v => v === 'conflicting').length,
  }

  const backToDocs = () => { window.location.search = '' }

  return (
    <main className={`study-main ${phase === 'report' ? '' : 'center'}`}>
      {phase === 'choose' && (
        <>
          <p className="study-progress">Practice exam · {destinationName}</p>
          <h1 className="study-question">How do you want to be tested?</h1>
          <div className="exam-format-cards">
            <button className="exam-format-card" onClick={() => forge('written')}>
              <span className="exam-format-name">✍ Written answers</span>
              <span className="exam-format-sub">Type from memory — the harder rep, the stronger memory.</span>
            </button>
            <button className="exam-format-card" onClick={() => forge('mcq')}>
              <span className="exam-format-name">☑ Multiple choice</span>
              <span className="exam-format-sub">Pick from four — faster, instant checking.</span>
            </button>
          </div>
        </>
      )}

      {phase === 'forging' && (
        <>
          <p className="study-done-big">Writing your exam…</p>
          <p className="study-next-due">From your own clips in {destinationName} — nothing else.</p>
        </>
      )}

      {phase === 'error' && (
        <>
          <p className="study-done-big">Hm — that didn't work.</p>
          <p className="exam-error">{error}</p>
          <div className="study-grade" style={{ justifyContent: 'flex-start' }}>
            <button className="study-secondary" onClick={backToDocs}>← Back to docs</button>
            <button className="study-primary" onClick={() => forge(format)}>Try again</button>
          </div>
        </>
      )}

      {phase === 'exam' && current && (
        <>
          <p className="study-progress">
            Question {index + 1} of {questions.length}
            <span className={`exam-kind exam-kind-${current.kind}`}>{KIND_LABEL[current.kind]}</span>
          </p>
          <h1 className="study-question">{current.question}</h1>
          {format === 'mcq' && current.options ? (
            <div className="exam-options" role="radiogroup" aria-label="Answer choices">
              {current.options.map((opt, oi) => (
                <button
                  key={oi}
                  className={`exam-option${choice === oi ? ' picked' : ''}`}
                  role="radio"
                  aria-checked={choice === oi}
                  onClick={() => setChoice(prev => (prev === oi ? null : oi))}
                >
                  <span className="exam-option-letter">{'ABCD'[oi]}</span>
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              className="study-attempt exam-answer"
              placeholder="Your answer… (leave empty to skip)"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); next() }
              }}
            />
          )}
          <div className="study-grade" style={{ justifyContent: 'flex-start' }}>
            <button className="study-primary" onClick={next}>
              {index + 1 < questions.length ? 'Next question ▸' : 'Finish & check'}
            </button>
            {format === 'mcq' && choice === null && <span className="exam-skip-hint">No pick = skip</span>}
          </div>
        </>
      )}

      {phase === 'checking' && (
        <p className="study-done-big">Checking against your clips…</p>
      )}

      {phase === 'report' && (
        <>
          <p className="study-progress">Practice exam · {destinationName}</p>
          {/* Counts, never a score. */}
          <h1 className="ladder-title">
            {counts.covered} covered · {counts.missed} to revisit
            {counts.conflicting > 0 ? ` · ${counts.conflicting} to double-check` : ''}
          </h1>
          <div className="exam-report">
            {questions.map((q, i) => {
              const v = verdicts[i]
              const clip = byId.get(q.sourceSavedAt)
              const open = revealed.has(i)
              return (
                <div key={i} className="study-answer exam-item">
                  <div className="exam-item-head">
                    <span className={`exam-verdict exam-verdict-${v}`}>
                      {VERDICT_META[v].glyph} {VERDICT_META[v].label}
                    </span>
                    <span className={`exam-kind exam-kind-${q.kind}`}>{KIND_LABEL[q.kind]}</span>
                  </div>
                  <p className="study-answer-text">{q.question}</p>
                  {answers[i] ? (
                    <p className="study-attempt-echo">{answers[i]}</p>
                  ) : (
                    <p className="exam-skipped">— skipped —</p>
                  )}
                  {format === 'mcq' && v !== 'covered' && q.options && q.correctIndex !== undefined && (
                    <p className="exam-correct">Your clip says: {q.options[q.correctIndex]}</p>
                  )}
                  {v !== 'covered' && clip && (
                    <>
                      {open && <p className="teach-source">{clip.text}</p>}
                      <button
                        className="teach-reveal"
                        onClick={() =>
                          setRevealed(prev => {
                            const nxt = new Set(prev)
                            if (nxt.has(i)) nxt.delete(i)
                            else nxt.add(i)
                            return nxt
                          })
                        }
                        aria-expanded={open}
                      >
                        {open ? 'Hide the clip ↑' : 'Show the clip ↓'}
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="study-grade" style={{ justifyContent: 'flex-start' }}>
            <button className="study-secondary" onClick={backToDocs}>← Back to docs</button>
            <button className="study-secondary" onClick={() => setPhase('choose')}>Forge another</button>
          </div>
        </>
      )}
    </main>
  )
}
