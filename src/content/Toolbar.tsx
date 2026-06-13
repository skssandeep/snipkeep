import React, { useState } from 'react'
import type { Destination } from '../types'

const STYLES = `
  @keyframes clipnote-in {
    from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.97); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0px) scale(1); }
  }
  .wrap {
    transform: translateX(-50%);
    pointer-events: auto;
    animation: clipnote-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    position: relative;
  }
  .toolbar {
    display: inline-flex;
    align-items: center;
    background: #1a1a1a;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    white-space: nowrap;
    user-select: none;
    overflow: hidden;
  }
  .btn-save {
    background: #c8f135;
    color: #000;
    border: none;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.1s;
    height: 100%;
  }
  .btn-save:hover { opacity: 0.85; }
  .btn-save:disabled { opacity: 0.4; cursor: default; }
  .btn-chevron {
    background: #a8cc20;
    color: #000;
    border: none;
    border-left: 1px solid rgba(0,0,0,0.15);
    padding: 7px 8px;
    font-size: 10px;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.1s;
    height: 100%;
    display: flex;
    align-items: center;
  }
  .btn-chevron:hover { opacity: 0.85; }
  .btn-close {
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
    padding: 7px 10px;
    font-size: 14px;
    line-height: 1;
    font-family: inherit;
    transition: color 0.1s;
  }
  .btn-close:hover { color: #999; }
  .status {
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 500;
  }
  .status.saving { color: #888; }
  .status.saved  { color: #c8f135; }
  .status.error  { color: #ff6b6b; font-size: 12px; }
  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    min-width: 180px;
    z-index: 1;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    color: #ccc;
    border: none;
    background: none;
    font-family: inherit;
    width: 100%;
    text-align: left;
    transition: background 0.1s;
  }
  .dropdown-item:hover { background: #252525; color: #fff; }
  .dropdown-item .check { color: #c8f135; width: 14px; flex-shrink: 0; }
  .dropdown-item .dest-name { flex: 1; }
  .dropdown-item .dest-type {
    font-size: 10px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
`

type State = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  destinations: Destination[]
  defaultDestId: string
  onSave: (destId: string, destType: 'gdoc' | 'notion') => Promise<void>
  onDismiss: () => void
}

export function Toolbar({ destinations, defaultDestId, onSave, onDismiss }: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [activeDestId, setActiveDestId] = useState(defaultDestId)
  const [showDropdown, setShowDropdown] = useState(false)

  const activeDest = destinations.find(d => d.id === activeDestId) ?? destinations[0]
  const label = activeDest ? `Save to ${activeDest.name}` : 'Save to Notes'

  const handleSave = async (dest?: Destination) => {
    const target = dest ?? activeDest
    if (!target) return
    setState('saving')
    setShowDropdown(false)
    try {
      await onSave(target.id, target.type)
      setState('saved')
      setTimeout(onDismiss, 1400)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  const handlePickDest = (dest: Destination) => {
    setActiveDestId(dest.id)
    handleSave(dest)
  }

  if (state !== 'idle') {
    return (
      <>
        <style>{STYLES}</style>
        <div className="wrap">
          <div className="toolbar">
            {state === 'saving' && <span className="status saving">Saving…</span>}
            {state === 'saved'  && <span className="status saved">✓ Saved</span>}
            {state === 'error'  && (
              <>
                <span className="status error">{errorMsg}</span>
                <button className="btn-close" onClick={onDismiss}>✕</button>
              </>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="wrap">
        <div className="toolbar">
          <button className="btn-save" onClick={() => handleSave()}>{label}</button>
          {destinations.length > 1 && (
            <button
              className="btn-chevron"
              onClick={() => setShowDropdown(v => !v)}
              title="Choose destination"
            >
              ▾
            </button>
          )}
        </div>

        {showDropdown && (
          <div className="dropdown">
            {destinations.map(dest => (
              <button
                key={dest.id}
                className="dropdown-item"
                onClick={() => handlePickDest(dest)}
              >
                <span className="check">{dest.id === activeDestId ? '✓' : ''}</span>
                <span className="dest-name">{dest.name}</span>
                <span className="dest-type">{dest.type === 'notion' ? 'Notion' : 'Docs'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
