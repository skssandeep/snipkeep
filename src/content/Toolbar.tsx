import React, { useState, useRef, useEffect } from 'react'
import { MdCheck, MdClose, MdEdit, MdKeyboardReturn, MdMic, MdMoreHoriz } from 'react-icons/md'
import type {
  Destination,
  ToolbarApi,
  StartVoiceNoteMessage,
  StartVoiceNoteResponse,
  StopVoiceNoteMessage,
  VoiceNoteUpdateMessage,
} from '../types'

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
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
    display: inline-flex;
    align-items: center;
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
  .dropdown-item .check { display: inline-flex; align-items: center; justify-content: center; color: #A99CFF; width: 14px; flex-shrink: 0; font-size: 11px; }
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
  .note-hint { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: #6E6980; }
  .note-foot-actions { display: flex; align-items: center; gap: 6px; }

  /* ── Mic button (voice-note capture) ── */
  @keyframes mic-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,107,0.35); }
    50%      { box-shadow: 0 0 0 4px rgba(255,107,107,0); }
  }
  .btn-mic {
    background: transparent;
    color: #A8A4B5;
    border: none;
    border-radius: 6px;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
  }
  .btn-mic:hover { background: rgba(255,255,255,0.06); color: #F2F1F5; }
  .btn-mic.recording {
    color: #FF6B6B;
    animation: mic-pulse 1.4s ease-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .btn-mic.recording { animation: none; }
  }
  .note-voice-error {
    font-size: 11px;
    color: #FF8A8A;
    margin-top: 5px;
    padding: 0 2px;
  }

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

  // Voice-note capture. Feature-detected directly here (not via a round-trip
  // to the offscreen doc) — the API's mere existence isn't origin-restricted,
  // only actually using the microphone is, so checking window here is valid.
  const [voiceSupported] = useState(() => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
  const [isRecording, setIsRecording] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const isRecordingRef = useRef(false)
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  // The note's value at the instant recording starts — each transcript update
  // REPLACES (never appends to) the "this session" portion, since interim
  // results re-fire with cumulative text each time; naive appending would
  // duplicate words on every update.
  const baseNoteRef = useRef('')
  // Always the actual current note text, kept in sync at every write site
  // (both the textarea's own onChange and the transcript handler below) —
  // not derived from a useEffect, so there's no risk of it lagging behind a
  // fast-arriving message. This is what lets the transcript handler detect
  // "did the user just type something manually" without a stale closure.
  const noteValueRef = useRef('')
  // The exact string voice itself last wrote. If noteValueRef no longer
  // matches this, the user edited the box by hand since — see the
  // transcript handler below for why that matters.
  const lastVoiceWriteRef = useRef('')
  // The last raw (combined final+interim) session text seen from the voice
  // tab, for diffing out just the newly-added part after a manual edit.
  const lastSessionTextRef = useRef('')
  // Set when the user hits Enter or clicks "Save with note" while still
  // recording — the save is deferred until the real 'ended' event confirms
  // the final transcript has landed, not fired immediately (the transcript
  // may still be finalizing when the key is pressed).
  const saveAfterStopRef = useRef(false)
  // Always the latest handleSave closure — the message-listener effect below
  // has an empty dependency array (registers once), so calling handleSave()
  // directly from inside it would use a stale closure over old `note`/
  // `activeDest`. Refreshed after every render instead.
  const handleSaveRef = useRef<(dest?: Destination) => void>(() => {})

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

  // VOICE_NOTE_UPDATE is the one message type used on the background→Toolbar
  // leg (see types.ts) — the background relays it via chrome.tabs.sendMessage
  // with this exact tab+frame's id, so this listener only ever sees events
  // meant for THIS toolbar instance, never another tab's.
  useEffect(() => {
    function handleMessage(message: VoiceNoteUpdateMessage) {
      if (message.type !== 'VOICE_NOTE_UPDATE') return
      const { event } = message
      if (event.kind === 'transcript') {
        const prevSession = lastSessionTextRef.current
        const newSession = event.text
        lastSessionTextRef.current = newSession

        if (noteValueRef.current === lastVoiceWriteRef.current) {
          // Nothing changed since our last write — safe to fully replace,
          // same as before.
          const next = baseNoteRef.current + (baseNoteRef.current ? ' ' : '') + newSession
          setNote(next)
          noteValueRef.current = next
          lastVoiceWriteRef.current = next
        } else {
          // The user typed something in the box since our last write — never
          // silently overwrite that. Append only the NEW part of the session
          // text (best-effort prefix diff; an occasional duplicated word from
          // an interim self-correction is a far smaller cost than erasing an
          // edit the user just made on purpose).
          const delta = (newSession.startsWith(prevSession) ? newSession.slice(prevSession.length) : newSession).trim()
          if (delta) {
            const current = noteValueRef.current
            const next = current + (current && !current.endsWith(' ') ? ' ' : '') + delta
            setNote(next)
            noteValueRef.current = next
            lastVoiceWriteRef.current = next
          }
        }
      } else if (event.kind === 'error') {
        setVoiceError(event.error)
        setIsRecording(false)
        saveAfterStopRef.current = false  // don't save on an error path
      } else {
        setIsRecording(false)
        if (saveAfterStopRef.current) {
          saveAfterStopRef.current = false
          handleSaveRef.current()
        }
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  // Stop a forgotten-open mic if the toolbar itself goes away (save/dismiss)
  // while still recording — otherwise the voice tab keeps listening with
  // nothing left to receive its updates.
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        chrome.runtime.sendMessage({ type: 'STOP_VOICE_NOTE' } satisfies StopVoiceNoteMessage)
      }
    }
  }, [])

  // Recording should only ever be "a thing" while its own UI (the note
  // panel) is visible — dismissing the panel any other way (Escape, opening
  // the destination dropdown) previously left it running invisibly, with no
  // surface left showing it was still listening. A live recording is always
  // tied to the panel being open, never allowed to outlive it.
  useEffect(() => {
    if (!showNote && isRecordingRef.current) {
      setIsRecording(false)
      chrome.runtime.sendMessage({ type: 'STOP_VOICE_NOTE' } satisfies StopVoiceNoteMessage)
    }
  }, [showNote])

  const handleMicClick = async () => {
    if (isRecording) {
      setIsRecording(false)  // optimistic — feels immediate; a late transcript/ended event is a no-op either way
      chrome.runtime.sendMessage({ type: 'STOP_VOICE_NOTE' } satisfies StopVoiceNoteMessage)
      return
    }
    setVoiceError('')
    baseNoteRef.current = note
    // Treat whatever's already in the box as "voice's own last write" for
    // this fresh session — nothing manual has happened *since* yet, so the
    // first transcript update should take the normal fast-replace path, not
    // mistake the pre-existing text for a mid-session edit to preserve
    // (baseNoteRef already accounts for it as the prefix).
    lastVoiceWriteRef.current = note
    lastSessionTextRef.current = ''
    const res: StartVoiceNoteResponse = await chrome.runtime.sendMessage(
      { type: 'START_VOICE_NOTE' } satisfies StartVoiceNoteMessage
    )
    if (res?.success) setIsRecording(true)
    else setVoiceError(res?.error ?? 'Could not start voice input.')
  }

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

  // Shared by the Enter key and the "Save with note" button: if still
  // recording, the save can't fire immediately — the transcript may still be
  // finalizing — so it's deferred until the real 'ended' event confirms the
  // final text has landed (see the VOICE_NOTE_UPDATE handler above).
  const handleSaveRequest = () => {
    if (isRecording) {
      saveAfterStopRef.current = true
      handleMicClick()
    } else {
      handleSave()
    }
  }
  useEffect(() => { handleSaveRef.current = handleSave })

  const handleNoteKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSaveRequest()
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
      if (action === 'save') handleSaveRequest()
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
            {state === 'saved'  && <span className="status saved"><MdCheck size={14} /> Saved</span>}
            {state === 'error'  && (
              <>
                <span className="status error">{errorMsg}</span>
                <button className="btn-close" onClick={onDismiss}><MdClose size={13} /></button>
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
            onClick={handleSaveRequest}
          >
            {label}
          </button>
          <button
            className={`btn-note${showNote ? ' active' : ''}${navActive && highlight === 1 ? ' kbd-focus' : ''}`}
            onClick={() => { setShowNote(v => !v); setShowDropdown(false) }}
            title="Add your take"
          >
            <MdEdit size={14} />
          </button>
          {destinations.length > 1 && (
            <button
              className={`btn-menu${showDropdown ? ' active' : ''}${navActive && highlight === 2 ? ' kbd-focus' : ''}`}
              onClick={() => { setShowDropdown(v => !v); setShowNote(false) }}
              title="Choose destination"
            >
              <MdMoreHoriz size={16} />
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
              onChange={e => { setNote(e.target.value); noteValueRef.current = e.target.value }}
              onKeyDown={handleNoteKey}
            />
            <div className="note-foot">
              <span className="note-hint"><MdKeyboardReturn size={11} /> save · ⇧<MdKeyboardReturn size={11} /> newline</span>
              <div className="note-foot-actions">
                {voiceSupported && (
                  <button
                    type="button"
                    className={`btn-mic${isRecording ? ' recording' : ''}`}
                    onClick={handleMicClick}
                    title={isRecording ? 'Stop voice input' : 'Speak your note'}
                  >
                    <MdMic size={15} />
                  </button>
                )}
                <button className="note-save" onClick={handleSaveRequest}>Save with note</button>
              </div>
            </div>
            {voiceError && <div className="note-voice-error">{voiceError}</div>}
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
                <span className="check">{dest.id === activeDestId ? <MdCheck /> : null}</span>
                <span className="dest-name">{dest.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
