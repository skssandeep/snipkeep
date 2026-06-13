import React, { useState } from 'react'
import type { Destination } from '../types'

const STYLES = `
  @keyframes clipnote-in {
    from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.96); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  }
  @keyframes menu-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.97); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  }

  .wrap {
    transform: translateX(-50%);
    pointer-events: auto;
    animation: clipnote-in 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    position: relative;
  }

  .toolbar {
    display: inline-flex;
    align-items: stretch;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    user-select: none;
    box-shadow: 0 4px 16px rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.18);
  }

  /* Dark surface — recedes from any page, lime accent carries the action */
  .toolbar.idle {
    background: #1c1c1c;
    border: 1px solid #2e2e2e;
  }

  .toolbar.feedback {
    background: #1c1c1c;
    border: 1px solid #2e2e2e;
    padding: 0 14px;
    gap: 8px;
    align-items: center;
  }

  /* Save button: lime accent label, transparent bg so the dark shell shows */
  .btn-save {
    background: transparent;
    color: #c8f135;
    border: none;
    padding: 0 15px;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s;
    height: 100%;
  }
  .btn-save:hover { background: rgba(200,241,53,0.08); }

  /* 3-dot menu trigger */
  .btn-menu {
    background: transparent;
    color: #555;
    border: none;
    border-left: 1px solid #2e2e2e;
    padding: 0 11px;
    font-size: 16px;
    line-height: 1;
    letter-spacing: 1px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
    display: flex;
    align-items: center;
    height: 100%;
  }
  .btn-menu:hover { background: rgba(255,255,255,0.05); color: #888; }

  /* ── Feedback states ── */
  .status {
    font-size: 13px;
    font-weight: 500;
  }
  .status.saving { color: #555; }
  .status.saved  { color: #c8f135; }
  .status.error  { color: #ff6b6b; font-size: 12px; }

  .btn-close {
    background: none;
    border: none;
    color: #444;
    cursor: pointer;
    padding: 0 2px;
    font-size: 12px;
    line-height: 1;
    font-family: inherit;
    transition: color 0.1s;
  }
  .btn-close:hover { color: #666; }

  /* ── Destination menu ── */
  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #1c1c1c;
    border: 1px solid #2e2e2e;
    border-radius: 9px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.25);
    min-width: 180px;
    z-index: 1;
    animation: menu-in 0.14s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: #aaa;
    border: none;
    background: none;
    font-family: inherit;
    width: 100%;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .dropdown-item:hover { background: #242424; color: #f0f0f0; }
  .dropdown-item .check { color: #c8f135; width: 14px; flex-shrink: 0; font-size: 11px; }
  .dropdown-item .dest-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .dropdown-item .dest-type {
    font-size: 10px;
    color: #3e3e3e;
    text-transform: uppercase;
    letter-spacing: 0.08em;
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
          <div className="toolbar feedback">
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
        <div className="toolbar idle">
          <button className="btn-save" onClick={() => handleSave()}>{label}</button>
          {destinations.length > 1 && (
            <button
              className="btn-menu"
              onClick={() => setShowDropdown(v => !v)}
              title="Choose destination"
            >
              ···
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
