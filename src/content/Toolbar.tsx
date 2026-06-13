import React, { useState } from 'react'

const STYLES = `
  @keyframes clipnote-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(4px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0px) scale(1);
    }
  }
  .wrap {
    transform: translateX(-50%);
    pointer-events: auto;
    animation: clipnote-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .toolbar {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #1a1a1a;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    padding: 7px 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    white-space: nowrap;
    user-select: none;
    cursor: default;
  }
  .icon { line-height: 1; }
  .label { color: #ccc; }
  .divider { width: 1px; height: 16px; background: #333; }
  .btn-save {
    background: #c8f135;
    color: #000;
    border: none;
    border-radius: 5px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.1s;
  }
  .btn-save:hover { opacity: 0.85; }
  .btn-save:disabled { opacity: 0.4; cursor: default; }
  .btn-close {
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
    padding: 0 2px;
    font-size: 14px;
    line-height: 1;
    font-family: inherit;
  }
  .btn-close:hover { color: #999; }
  .saved { color: #c8f135; font-size: 13px; font-weight: 500; }
  .error { color: #ff6b6b; font-size: 12px; }
`

type State = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  onSave: () => Promise<void>
  onDismiss: () => void
}

export function Toolbar({ onSave, onDismiss }: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSave = async () => {
    setState('saving')
    try {
      await onSave()
      setState('saved')
      setTimeout(onDismiss, 1400)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="wrap">
        <div className="toolbar">
          {state === 'idle' && (
            <>
              <button className="btn-save" onClick={handleSave}>Save to Notes</button>
              <button className="btn-close" onClick={onDismiss} title="Dismiss">✕</button>
            </>
          )}

          {state === 'saving' && (
            <>
              <span className="icon">⏳</span>
              <span className="label" style={{ color: '#888' }}>Saving…</span>
            </>
          )}

          {state === 'saved' && (
            <span className="saved">✓ Saved to Notes</span>
          )}

          {state === 'error' && (
            <>
              <span className="error">{errorMsg}</span>
              <button className="btn-close" onClick={onDismiss}>✕</button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
