import React, { useEffect, useState } from 'react'
import { Popup } from '../popup/Popup'
import popupStyles from '../popup/popup.css?inline'

const POPUP_CSS = popupStyles
  .replace(/:root\s*\{/g, ':host {')
  .replace(/\bbody\b/g, '.cn-popup-root')

const DRAWER_CSS = `
  @keyframes cn-drawer-in {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }
  @keyframes cn-drawer-out {
    from { transform: translateX(0); }
    to   { transform: translateX(100%); }
  }

  /* ── Shell ── */
  .cn-drawer {
    position: fixed;
    top: 0;
    right: 0;
    height: 100dvh;
    width: 360px;
    display: flex;
    flex-direction: column;
    z-index: 2147483647;
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45), -1px 0 0 rgba(255,255,255,0.05);
    animation: cn-drawer-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cn-drawer.out {
    animation: cn-drawer-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  /* ── Sticky header — same pattern as Claude: app identity + close ── */
  .cn-header {
    display: flex;
    align-items: center;
    padding: 0 12px 0 16px;
    height: 48px;
    background: #242424;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }

  .cn-logo {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.3px;
  }
  .cn-logo span { color: #c8f135; }

  .cn-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .cn-btn-icon {
    background: none;
    border: none;
    color: #999;   /* #999 on #242424 = 4.78:1 — passes WCAG AA */
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 15px;
    line-height: 1;
    transition: background 0.12s, color 0.12s;
  }
  .cn-btn-icon:hover {
    background: rgba(255,255,255,0.07);
    color: #ccc;
  }

  /* ── Scrollable content area ── */
  .cn-body {
    flex: 1;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: #0f0f0f;
    scrollbar-width: thin;
    scrollbar-color: #2c2c2c transparent;
  }

  /* Suppress the Popup's own header — the drawer header replaces it */
  .cn-popup-root .header { display: none !important; }

  /* Force all popup containers to fill the drawer width */
  .cn-popup-root,
  .cn-popup-root .popup {
    width: 100%;
    box-sizing: border-box;
  }
`

interface Props {
  onClose: () => void
  closeRef: React.MutableRefObject<(() => void) | null>
}

export function Drawer({ onClose, closeRef }: Props) {
  const [exiting, setExiting] = useState(false)

  function close() {
    setExiting(true)
    setTimeout(onClose, 200)
  }

  closeRef.current = close

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <style>{POPUP_CSS}</style>
      <style>{DRAWER_CSS}</style>
      <div className={`cn-drawer${exiting ? ' out' : ''}`}>
        <div className="cn-header">
          <span className="cn-logo">Clip<span>Note</span></span>
          <div className="cn-header-actions">
            <button className="cn-btn-icon" onClick={close} title="Close (Esc)">✕</button>
          </div>
        </div>
        <div className="cn-body">
          <div className="cn-popup-root">
            <Popup />
          </div>
        </div>
      </div>
    </>
  )
}
