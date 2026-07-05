import React, { useState, useRef, useEffect } from 'react'
import type { Destination, ToolbarApi } from '../types'

const STYLES = `
  @keyframes snipkeep-in {
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
    animation: snipkeep-in 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    position: relative;
  }

  .toolbar {
    display: inline-flex;
    align-items: stretch;
    height: 36px;
    border-radius: 9px;
    overflow: hidden;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    user-select: none;
    box-shadow: 0 6px 20px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2);
  }

  /* Warm dark surface — recedes from any page, violet accent carries the action */
  .toolbar.idle {
    background: #17151D;
    border: 1px solid #2A2635;
  }

  .toolbar.feedback {
    background: #17151D;
    border: 1px solid #2A2635;
    padding: 0 14px;
    gap: 8px;
    align-items: center;
  }

  /* Save button: violet accent label, transparent bg so the dark shell shows */
  .btn-save {
    background: transparent;
    color: #A99CFF;
    border: none;
    padding: 0 16px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.1px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
    height: 100%;
  }
  .btn-save:hover { background: rgba(169,156,255,0.12); color: #BCB2FF; }

  /* Round the pill's end buttons to match its 8px inner radius (9px outer − 1px
     border), so the keyboard highlight ring follows the curve instead of being
     clipped square at the corners by the toolbar's overflow:hidden. */
  .toolbar > button:first-child {
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
  }
  .toolbar > button:last-child {
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
  }

  /* Keyboard highlight (←/→). Inset ring follows the button's rounded corners. */
  .btn-save.kbd-focus  { background: rgba(169,156,255,0.14); color: #BCB2FF; }
  .btn-note.kbd-focus  { background: rgba(169,156,255,0.14); color: #A99CFF; }
  .btn-menu.kbd-focus  { background: rgba(255,255,255,0.06); color: #F2F1F5; }
  .kbd-focus { box-shadow: inset 0 0 0 1.5px rgba(169,156,255,0.6); }

  /* 3-dot menu trigger — brightened to text-2 so the destination switcher is discoverable */
  .btn-menu {
    background: transparent;
    color: #A8A4B5;
    border: none;
    border-left: 1px solid #2A2635;
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
  .btn-menu:hover { background: rgba(255,255,255,0.05); color: #F2F1F5; }
  .btn-menu.active { background: rgba(255,255,255,0.05); color: #F2F1F5; }

  /* ── Feedback states ── */
  .status {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.1px;
  }
  .status.saving { color: #948FA1; }
  .status.saved  { color: #A99CFF; }
  .status.error  { color: #FF8A8A; font-size: 12px; }

  .btn-close {
    background: none;
    border: none;
    color: #948FA1;
    cursor: pointer;
    padding: 0 2px;
    font-size: 12px;
    line-height: 1;
    font-family: inherit;
    transition: color 0.1s;
  }
  .btn-close:hover { color: #F2F1F5; }

  /* ── Destination menu ── */
  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #232030;
    border: 1px solid #2A2635;
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3);
    min-width: 180px;
    z-index: 1;
    animation: menu-in 0.14s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 13px;
    color: #A8A4B5;
    border: none;
    background: none;
    font-family: inherit;
    width: 100%;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .dropdown-item:hover { background: #2E2A3E; color: #F2F1F5; }
  .dropdown-item .check { color: #A99CFF; width: 14px; flex-shrink: 0; font-size: 11px; }
  .dropdown-item .dest-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* ── Note affordance (pencil toggle) ── */
  .btn-note {
    background: transparent;
    color: #A8A4B5;
    border: none;
    border-left: 1px solid #2A2635;
    padding: 0 11px;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    font-family: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    transition: background 0.12s, color 0.12s;
  }
  .btn-note:hover { background: rgba(255,255,255,0.05); color: #F2F1F5; }
  .btn-note.active { color: #A99CFF; background: rgba(169,156,255,0.12); }

  /* ── Note panel ── */
  .note-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #232030;
    border: 1px solid #2A2635;
    border-radius: 10px;
    padding: 8px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3);
    width: 300px;
    z-index: 1;
    animation: menu-in 0.14s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .note-input {
    width: 100%;
    box-sizing: border-box;
    min-height: 52px;
    max-height: 140px;
    resize: none;
    background: #17151D;
    border: 1px solid #2A2635;
    border-radius: 7px;
    padding: 8px 10px;
    color: #F2F1F5;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.45;
    letter-spacing: -0.1px;
    outline: none;
    transition: border-color 0.12s;
  }
  .note-input:focus { border-color: #4A4360; }
  .note-input::placeholder { color: #6E6980; }
  .note-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 7px;
    padding: 0 2px;
  }
  .note-hint { font-size: 11px; color: #6E6980; }
  .note-save {
    background: rgba(169,156,255,0.12);
    color: #A99CFF;
    border: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.1px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
  }
  .note-save:hover { background: rgba(169,156,255,0.2); color: #BCB2FF; }
`

type State = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  destinations: Destination[]
  defaultDestId: string
  apiRef?: React.MutableRefObject<ToolbarApi | null>
  onSave: (destId: string, destType: 'gdoc' | 'notion', note?: string) => Promise<void>
  onDismiss: () => void
}

export function Toolbar({ destinations, defaultDestId, apiRef, onSave, onDismiss }: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [activeDestId, setActiveDestId] = useState(defaultDestId)
  const [showDropdown, setShowDropdown] = useState(false)
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // Keyboard-driven highlight across the toolbar's actions (←/→). `navActive`
  // stays false until the first arrow so mouse users never see a stuck ring.
  const [highlight, setHighlight] = useState(0)
  const [navActive, setNavActive] = useState(false)
  const highlightRef = useRef(0)
  useEffect(() => { highlightRef.current = highlight }, [highlight])
  // Synchronous re-entrancy guard: blocks a double-save from two Enter presses
  // landing before React re-renders the 'saving' state.
  const savingRef = useRef(false)

  useEffect(() => { if (showNote) noteRef.current?.focus() }, [showNote])

  const activeDest = destinations.find(d => d.id === activeDestId) ?? destinations[0]
  const label = activeDest ? `Save to ${activeDest.name}` : 'Save to Notes'

  const handleSave = async (dest?: Destination) => {
    const target = dest ?? activeDest
    if (!target || savingRef.current) return
    savingRef.current = true
    setState('saving')
    setShowDropdown(false)
    setShowNote(false)
    try {
      await onSave(target.id, target.type, note.trim() || undefined)
      setState('saved')
      setTimeout(onDismiss, 1400)
    } catch (err) {
      savingRef.current = false  // allow a retry after a failed save
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  const handleNoteKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setShowNote(false)
    }
  }

  // Actions the highlight can land on. Menu only exists with >1 destination.
  const actions: ('save' | 'note' | 'menu')[] =
    destinations.length > 1 ? ['save', 'note', 'menu'] : ['save', 'note']

  // Driven by page-level key presses (via apiRef). Returns true when consumed.
  const handleNavKey = (key: string): boolean => {
    if (state !== 'idle') {
      if (key === 'Escape') { onDismiss(); return true }
      return false  // ignore nav while saving / in a feedback state
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      setNavActive(true)
      const n = actions.length
      setHighlight(prev => key === 'ArrowRight' ? (prev + 1) % n : (prev - 1 + n) % n)
      return true
    }
    if (key === 'Enter') {
      const action = actions[highlightRef.current] ?? 'save'
      if (action === 'save') handleSave()
      else if (action === 'note') { setShowDropdown(false); setShowNote(true) }
      else { setShowNote(false); setShowDropdown(true) }
      return true
    }
    if (key === 'Escape') { onDismiss(); return true }
    return false
  }

  // Re-expose on every render so the closure always sees fresh state.
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = { handleNavKey }
    return () => { if (apiRef.current?.handleNavKey === handleNavKey) apiRef.current = null }
  })

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
        <div className="toolbar idle" role="toolbar" aria-label="SnipKeep">
          <button
            className={`btn-save${navActive && highlight === 0 ? ' kbd-focus' : ''}`}
            onClick={() => handleSave()}
          >
            {label}
          </button>
          <button
            className={`btn-note${showNote ? ' active' : ''}${navActive && highlight === 1 ? ' kbd-focus' : ''}`}
            onClick={() => { setShowNote(v => !v); setShowDropdown(false) }}
            title="Add your take"
          >
            ✎
          </button>
          {destinations.length > 1 && (
            <button
              className={`btn-menu${showDropdown ? ' active' : ''}${navActive && highlight === 2 ? ' kbd-focus' : ''}`}
              onClick={() => { setShowDropdown(v => !v); setShowNote(false) }}
              title="Choose destination"
            >
              ···
            </button>
          )}
        </div>

        {showNote && (
          <div className="note-panel">
            <textarea
              ref={noteRef}
              className="note-input"
              placeholder="Add your take… (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={handleNoteKey}
            />
            <div className="note-foot">
              <span className="note-hint">↵ save · ⇧↵ newline</span>
              <button className="note-save" onClick={() => handleSave()}>Save with note</button>
            </div>
          </div>
        )}

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
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
