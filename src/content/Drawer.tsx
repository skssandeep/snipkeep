import React, { useEffect, useRef, useState } from 'react'
import { Popup } from '../popup/Popup'
import popupStyles from '../popup/popup.css?inline'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SHEET_CSS,
} from '@/components/ui/sheet'

const POPUP_CSS = popupStyles
  .replace(/:root\s*\{/g, ':host {')
  .replace(/\bbody\b/g, '.cn-popup-root')

const BODY_CSS = `
  .cn-body {
    flex: 1;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .cn-popup-root .header { display: none !important; }
  .cn-popup-root,
  .cn-popup-root .popup { width: 100%; box-sizing: border-box; }

  /* ── Avatar chip ── */
  .cn-avatar {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    color: #000;
    font-size: 12px;
    font-weight: 700;
    font-family: var(--font);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    flex-shrink: 0;
    transition: opacity 0.15s;
    user-select: none;
  }
  .cn-avatar:hover { opacity: 0.85; }

  /* ── Sign-out dropdown ── */
  .cn-auth-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 200px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    overflow: hidden;
    z-index: 10;
  }

  .cn-auth-email {
    padding: 10px 14px;
    font-size: 11px;
    font-family: var(--font);
    color: var(--text-3);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cn-auth-signout {
    display: block;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: var(--danger);
    font-size: 13px;
    font-family: var(--font);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .cn-auth-signout:hover { background: rgba(255, 107, 107, 0.08); }
`

interface Props {
  container: HTMLElement
  onClose: () => void
  closeRef: React.MutableRefObject<(() => void) | null>
}

export function Drawer({ container, onClose, closeRef }: Props) {
  const [open, setOpen] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [showAuthMenu, setShowAuthMenu] = useState(false)
  const avatarRef = useRef<HTMLButtonElement>(null)

  // Read email from storage and keep it in sync as the user signs in/out
  useEffect(() => {
    chrome.storage.sync.get(['userEmail'], (result) => {
      setUserEmail((result.userEmail as string) ?? '')
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('userEmail' in changes) setUserEmail(changes.userEmail.newValue as string ?? '')
      if ('isSignedIn' in changes && !changes.isSignedIn.newValue) setUserEmail('')
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  // Close the auth dropdown when clicking outside it (inside shadow DOM)
  useEffect(() => {
    if (!showAuthMenu) return
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.composedPath()[0] as Node)) {
        setShowAuthMenu(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showAuthMenu])

  function close() {
    setOpen(false)
  }

  closeRef.current = close

  function handleOpenChange(next: boolean) {
    if (!next) setTimeout(onClose, 220)
  }

  function handleSignOut() {
    setShowAuthMenu(false)
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      const clear = () => {
        chrome.storage.sync.set({ isSignedIn: false, userEmail: '' })
        setUserEmail('')
      }
      if (!token) { clear(); return }
      chrome.identity.removeCachedAuthToken({ token }, clear)
    })
  }

  const initial = userEmail ? userEmail[0].toUpperCase() : ''

  return (
    <>
      <style>{POPUP_CSS}</style>
      <style>{SHEET_CSS}</style>
      <style>{BODY_CSS}</style>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          showClose={false}
          container={container}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle>
              Clip<span>Note</span>
            </SheetTitle>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {initial && (
                <button
                  ref={avatarRef}
                  className="cn-avatar"
                  onClick={() => setShowAuthMenu(v => !v)}
                  title={userEmail}
                >
                  {initial}
                  {showAuthMenu && (
                    <div className="cn-auth-dropdown">
                      <div className="cn-auth-email">{userEmail}</div>
                      <button className="cn-auth-signout" onClick={handleSignOut}>
                        Sign out
                      </button>
                    </div>
                  )}
                </button>
              )}
              <button className="cn-sheet-close-btn" onClick={close} title="Close (Esc)">
                ✕
              </button>
            </div>
          </SheetHeader>

          <div className="cn-body">
            <div className="cn-popup-root">
              <Popup />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
