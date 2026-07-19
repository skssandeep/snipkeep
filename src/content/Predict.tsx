import React, { useEffect, useRef, useState } from 'react'

// Predict-First (feature research PDF #04). This component is BOTH the
// per-video "☀ Predict mode" toggle pill and the prompt card that appears
// when the watcher in index.tsx crosses a chapter boundary. It lives in its
// own fixed bottom-right shadow host — like the toast, but persistent and
// interactive. Hardcoded palette hexes, same drift gotcha as Toolbar.tsx.

export interface PredictApi {
  isArmed: () => boolean
  showPrompt: (p: PredictPrompt) => void
}

export interface PredictPrompt {
  kind: 'predict' | 'recall'
  chapterTitle: string   // the chapter the question is ABOUT
  question: string
  videoTime: number
}

const STYLES = `
  @keyframes predict-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .wrap {
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: auto;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #18140F;
    border: 1px solid #2A2620;
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    color: #ADA9A1;
    cursor: pointer;
    font-family: inherit;
    box-shadow: 0 4px 14px rgba(0,0,0,0.35);
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .pill:hover { color: #EAE8E3; border-color: #463F31; }
  .pill.armed {
    background: #F4E151;
    border-color: #F4E151;
    color: #1C1608;
  }
  .pill:focus-visible { outline: 2px solid #F4E151; outline-offset: 2px; }

  .card {
    width: 372px;
    background: #18140F;
    border: 1px solid #2A2620;
    border-radius: 14px;
    padding: 18px 20px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.35);
    display: flex;
    flex-direction: column;
    gap: 12px;
    animation: predict-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .card { animation: none; }
  }
  .card-eyebrow {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .card-eyebrow-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #F4E151;
    white-space: nowrap;
  }
  .card-eyebrow-chapter {
    font-size: 12px;
    font-weight: 600;
    color: #979189;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .card-q {
    font-size: 15px;
    font-weight: 700;
    color: #EAE8E3;
    line-height: 1.45;
    letter-spacing: -0.2px;
  }
  .card-input {
    width: 100%;
    box-sizing: border-box;
    min-height: 60px;
    resize: none;
    background: #100D08;
    border: 1px solid #2A2620;
    border-radius: 10px;
    padding: 10px 12px;
    color: #EAE8E3;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.55;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .card-input:focus {
    border-color: #F4E151;
    box-shadow: 0 0 0 3px rgba(244, 225, 81, 0.10);
  }
  .card-input::placeholder { color: #6D6860; }
  .card-foot {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .card-hint { font-size: 11px; color: #6D6860; margin-right: auto; }
  .card-skip {
    background: none;
    border: none;
    padding: 8px 10px;
    font-size: 13px;
    font-weight: 600;
    color: #979189;
    cursor: pointer;
    font-family: inherit;
    border-radius: 8px;
    transition: color 0.12s;
  }
  .card-skip:hover { color: #EAE8E3; }
  .card-go {
    background: #F4E151;
    color: #1C1608;
    border: none;
    border-radius: 9px;
    padding: 9px 18px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s;
  }
  .card-go:hover { background: #FAEE91; }
  .card-go:focus-visible, .card-skip:focus-visible { outline: 2px solid #F4E151; outline-offset: 2px; }
`

interface Props {
  apiRef: React.MutableRefObject<PredictApi | null>
  // Resolves the default destination + canonical page facts at save time.
  onSave: (guess: string, prompt: PredictPrompt) => void
}

export function Predict({ apiRef, onSave }: Props) {
  const [armed, setArmed] = useState(false)
  const [prompt, setPrompt] = useState<PredictPrompt | null>(null)
  const [guess, setGuess] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const armedRef = useRef(false)
  useEffect(() => { armedRef.current = armed }, [armed])

  useEffect(() => {
    apiRef.current = {
      isArmed: () => armedRef.current,
      showPrompt: (p) => {
        setGuess('')
        setPrompt(p)
      },
    }
    return () => { apiRef.current = null }
  }, [apiRef])

  useEffect(() => { if (prompt) inputRef.current?.focus() }, [prompt])

  function resume(save: boolean) {
    if (!prompt) return
    const trimmed = guess.trim()
    if (save && trimmed) onSave(trimmed, prompt)
    setPrompt(null)
    setGuess('')
    // Don't restart a finished video — the end-of-video recall prompt fires
    // after 'ended', where play() would loop it back around.
    const video = document.querySelector('video')
    if (video && !video.ended) video.play().catch(() => {})
  }

  // Shadow-DOM retargeting bug this guards against: key events from the guess
  // box bubble to the document with e.target retargeted to the shadow HOST (a
  // plain div), so YouTube's hotkey handler doesn't recognize "user is
  // typing" and fires shortcuts — typing "C" toggled captions, "K" paused,
  // digits seeked. Stopping propagation at the card boundary (after our own
  // handlers have run) keeps every keystroke inside the card. keyup/keypress
  // too — some player bindings listen there.
  const trapKeys = {
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
    onKeyUp: (e: React.KeyboardEvent) => e.stopPropagation(),
    onKeyPress: (e: React.KeyboardEvent) => e.stopPropagation(),
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="wrap">
        {prompt && (
          <div className="card" role="dialog" aria-label="Prediction prompt" {...trapKeys}>
            <div className="card-eyebrow">
              <span className="card-eyebrow-label">{prompt.kind === 'recall' ? '↺ Recall' : '☀ Predict'}</span>
              <span className="card-eyebrow-chapter">{prompt.chapterTitle}</span>
            </div>
            <div className="card-q">{prompt.question}</div>
            <textarea
              ref={inputRef}
              className="card-input"
              placeholder="Type your guess… (or just think it)"
              value={guess}
              onChange={e => setGuess(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); resume(true) }
                else if (e.key === 'Escape') { e.preventDefault(); resume(false) }
              }}
            />
            <div className="card-foot">
              <span className="card-hint">Never graded</span>
              <button className="card-skip" onClick={() => resume(false)}>Skip</button>
              <button className="card-go" onClick={() => resume(true)}>Continue ▸</button>
            </div>
          </div>
        )}
        <button
          className={`pill${armed ? ' armed' : ''}`}
          onClick={() => {
            setArmed(v => !v)
            // Disarming mid-prompt dismisses the card and resumes playback.
            if (armed && prompt) resume(false)
          }}
          title={armed ? 'Predict mode is on — pauses at chapter boundaries with one question' : 'Pause at chapter boundaries and guess what comes next'}
        >
          ☀ Predict mode{armed ? ': on' : ''}
        </button>
      </div>
    </>
  )
}
