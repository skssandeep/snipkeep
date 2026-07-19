import React, { useEffect, useRef, useState } from 'react'

// Predict-First (feature research PDF #04). This component is BOTH the
// per-video "☀ Predict mode" toggle pill and the prompt card that appears
// when the watcher in index.tsx crosses a chapter boundary. It lives in its
// own fixed bottom-right shadow host — like the toast, but persistent and
// interactive. Hardcoded palette hexes, same drift gotcha as Toolbar.tsx.

export interface PredictApi {
  isArmed: () => boolean
  showPrompt: (chapterTitle: string, videoTime: number) => void
}

const STYLES = `
  @keyframes predict-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
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
    width: 340px;
    background: #18140F;
    border: 1px solid #2A2620;
    border-left: 3px solid #F4E151;
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: predict-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .card { animation: none; }
  }
  .card-q {
    font-size: 14px;
    font-weight: 600;
    color: #EAE8E3;
    line-height: 1.5;
  }
  .card-input {
    width: 100%;
    box-sizing: border-box;
    min-height: 56px;
    resize: none;
    background: #100D08;
    border: 1px solid #2A2620;
    border-radius: 8px;
    padding: 9px 11px;
    color: #EAE8E3;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    outline: none;
    transition: border-color 0.12s;
  }
  .card-input:focus { border-color: #463F31; }
  .card-input::placeholder { color: #6D6860; }
  .card-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .card-hint { font-size: 11px; color: #6D6860; }
  .card-go {
    background: #F4E151;
    color: #1C1608;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s;
  }
  .card-go:hover { background: #FAEE91; }
  .card-go:focus-visible { outline: 2px solid #EAE8E3; outline-offset: 2px; }
`

interface Props {
  apiRef: React.MutableRefObject<PredictApi | null>
  // Resolves the default destination + canonical page facts at save time.
  onSave: (guess: string, chapterTitle: string, videoTime: number) => void
}

export function Predict({ apiRef, onSave }: Props) {
  const [armed, setArmed] = useState(false)
  const [prompt, setPrompt] = useState<{ chapterTitle: string; videoTime: number } | null>(null)
  const [guess, setGuess] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const armedRef = useRef(false)
  useEffect(() => { armedRef.current = armed }, [armed])

  useEffect(() => {
    apiRef.current = {
      isArmed: () => armedRef.current,
      showPrompt: (chapterTitle, videoTime) => {
        setGuess('')
        setPrompt({ chapterTitle, videoTime })
      },
    }
    return () => { apiRef.current = null }
  }, [apiRef])

  useEffect(() => { if (prompt) inputRef.current?.focus() }, [prompt])

  function resume(save: boolean) {
    if (!prompt) return
    const trimmed = guess.trim()
    if (save && trimmed) onSave(trimmed, prompt.chapterTitle, prompt.videoTime)
    setPrompt(null)
    setGuess('')
    document.querySelector('video')?.play().catch(() => {})
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="wrap">
        {prompt && (
          <div className="card" role="dialog" aria-label="Prediction prompt">
            <div className="card-q">
              Before continuing — what do you think “{prompt.chapterTitle}” will cover? Take a guess.
            </div>
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
              <span className="card-hint">Never graded · esc skips</span>
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
