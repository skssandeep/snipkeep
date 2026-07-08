import React, { useEffect, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { MdClose, MdKeyboardReturn, MdLock, MdLogout } from 'react-icons/md'
import type { GetUserProfileMessage, GetUserProfileResponse, SignOutMessage, DocDestination } from '../types'
import { Popup, PrivacyLedger, TrustCard } from '../popup/Popup'
import { ensureFontLoaded } from '../lib/fonts'
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
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .cn-popup-root .header { display: none !important; }
  .cn-popup-root,
  .cn-popup-root .popup { width: 100%; box-sizing: border-box; }

  /* ── Logo mark ── */
  .cn-logo-mark {
    display: inline-flex;
    align-items: center;
    color: var(--accent);
    margin-right: 7px;
  }

  /* ── Header actions cluster ── */
  .cn-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  /* Visually hidden but present for screen readers (Radix requires a title) */
  .cn-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── Avatar chip — quiet ghost style, ring not fill ──
     .cn-avatar-wrap (not .cn-avatar itself) carries position:relative — the
     dropdown anchors to this wrapper as a SIBLING of the trigger button, not
     a child of it. A <button> can never contain another <button> (invalid
     HTML; the parser force-closes the outer one early the moment it hits the
     first nested one, silently rewriting the DOM so Privacy/Sign out end up
     outside the dropdown's own positioned box entirely — a real bug, found
     by diffing the parsed DOM against the JSX, not a hypothetical). ── */
  .cn-avatar-wrap { position: relative; flex-shrink: 0; }
  .cn-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: transparent;
    color: var(--text-2);
    font-size: 11px;
    font-weight: 700;
    font-family: var(--font);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: 1.5px solid var(--border-active);
    transition: border-color 0.15s, color 0.15s;
    user-select: none;
  }
  .cn-avatar:hover { border-color: var(--accent); color: var(--text); }
  .cn-avatar:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* ── Sign-out dropdown ──
     Three tiers, in order of a Jakob's-Law-familiar account menu:
       1. Identity (avatar + name + email) — who you are, one grouped fact.
       2. Privacy — a settings-like, informational action.
       3. Sign out — the one destructive-ish action, visually distinct (danger
          color) and last.
     Each tier shares one padding rhythm (var(--space-3) var(--space-4), the
     same convention documented for content cards elsewhere in this app) so
     the whole menu reads as one consistent rhythm, not three ad-hoc rows.

     Gotcha this fixed: this whole dropdown lives inside the <button
     class="cn-avatar"> that opens it. Browsers' default UA stylesheet puts
     text-align: center on <button>, and text-align is an inherited property
     — so any text in here that doesn't set its OWN text-align silently
     inherits centered alignment from that ancestor button, not from
     anything written here. .cn-auth-privacy/.cn-auth-signout already
     escaped it by setting text-align: left explicitly; .cn-auth-identity
     didn't, which is exactly why only the name/email were rendering
     centered in the real extension while a standalone test render (not
     nested in a <button>) looked correctly left-aligned — the bug only
     exists in the real nesting, not in isolation. Now set explicitly on
     .cn-auth-identity so it isn't relying on the button's default not
     changing. ── */
  .cn-auth-dropdown {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 220px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    overflow: hidden;
    z-index: 10;
  }

  .cn-auth-identity {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  /* Larger sibling of the header's own .cn-avatar — same initial, same idea,
     given real presence as the profile card's visual anchor. Filled (not the
     header trigger's quiet ring-only style) since this is its one moment to
     be the focal point, not compete with everything else in the header row. */
  .cn-auth-avatar {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    font-family: var(--font);
    user-select: none;
  }
  .cn-auth-text {
    min-width: 0;  /* lets ellipsis truncation work inside a flex child */
    flex: 1;
  }
  .cn-auth-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cn-auth-email {
    font-size: 11.5px;
    font-family: var(--font);
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cn-auth-privacy {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    font-size: 13px;
    font-family: var(--font);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .cn-auth-privacy:hover { background: var(--card-2); color: var(--text); }

  .cn-auth-signout {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: var(--space-3) var(--space-4);
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

  /* ── Footer — pinned to the bottom of the panel (margin-top:auto) so the card
        cluster anchors the top and the empty middle reads as deliberate breathing
        room, not a half-rendered void. When the doc list grows tall enough to
        scroll, the auto margin collapses and the hint trails the content. ── */
  .cn-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 16px 20px 20px;
    margin-top: auto;
    border-top: 1px solid var(--border);
  }
  .cn-kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 19px;
    height: 19px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--card-2);
    color: var(--text-2);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 600;
  }
  .cn-footer-text {
    margin-left: 4px;
    font-size: 13px;
    color: var(--text-3);
    font-family: var(--font);
  }
`

interface Props {
  container: HTMLElement
  onClose: () => void
  closeRef: React.MutableRefObject<(() => void) | null>
}

export function Drawer({ container, onClose, closeRef }: Props) {
  const [open, setOpen] = useState(true)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('')
  const [showAuthMenu, setShowAuthMenu] = useState(false)
  type DrawerView = 'main' | 'privacy' | 'trust'
  const [view, setView] = useState<DrawerView>('main')
  const [firstDocId, setFirstDocId] = useState<string | null>(null)
  // On the wrapper div, not the trigger button — the dropdown is now a
  // sibling of the button (see .cn-avatar-wrap), so .contains() needs to
  // cover both for the outside-click check below to recognize a click
  // inside the dropdown as "inside," not "outside."
  const avatarRef = useRef<HTMLDivElement>(null)
  // Guards the Trust Card so it only ever auto-triggers once per drawer session,
  // even if the mount check and the 'docs' storage listener both fire.
  const trustShownRef = useRef(false)

  useEffect(() => {
    ensureFontLoaded()

    chrome.storage.sync.get(['isSignedIn', 'userEmail', 'userName', 'docs', 'hasSeenTrustCard'], (result) => {
      const signedIn = !!result.isSignedIn
      const email = (result.userEmail as string) ?? ''
      const name = (result.userName as string) ?? ''
      const docs = (result.docs as DocDestination[] | undefined) ?? []
      setIsSignedIn(signedIn)
      setUserEmail(email)
      setUserName(name)
      setFirstDocId(docs[0]?.id ?? null)

      // First time this account has ever had a doc AND never dismissed the card —
      // e.g. an existing user opening the drawer after this feature shipped.
      if (signedIn && docs.length > 0 && !result.hasSeenTrustCard && !trustShownRef.current) {
        trustShownRef.current = true
        setView('trust')
      }

      // Email/name not cached yet — ask the background service worker
      // (getProfileUserInfo works reliably there, not always in content
      // scripts; name additionally needs a token silently upgraded to the
      // userinfo.profile scope, which an already-signed-in user may not have
      // yet — that's fine, it just comes back null until their next sign-in).
      if (signedIn && (!email || !name)) {
        chrome.runtime.sendMessage(
          { type: 'GET_USER_PROFILE' } satisfies GetUserProfileMessage,
          (res: GetUserProfileResponse) => {
            if (res?.email) setUserEmail(res.email)
            if (res?.name) setUserName(res.name)
          }
        )
      }
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('isSignedIn' in changes) setIsSignedIn(!!changes.isSignedIn.newValue)
      if ('userEmail' in changes) setUserEmail(changes.userEmail.newValue as string ?? '')
      if ('userName' in changes) setUserName(changes.userName.newValue as string ?? '')
      if ('docs' in changes) {
        const docs = (changes.docs.newValue as DocDestination[] | undefined) ?? []
        setFirstDocId(docs[0]?.id ?? null)
        // The user just added their very first doc while the drawer was already
        // open — re-check hasSeenTrustCard fresh (avoids a stale-closure read of
        // React state) and surface the card after a beat, so DocsTab's "added"
        // flash gets a moment to register before the view switches away from it.
        if (docs.length > 0 && !trustShownRef.current) {
          chrome.storage.sync.get(['hasSeenTrustCard'], (r) => {
            if (!r.hasSeenTrustCard && !trustShownRef.current) {
              trustShownRef.current = true
              setTimeout(() => setView('trust'), 1100)
            }
          })
        }
      }
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

  // Single close path for every trigger (× button, overlay/Esc, icon toggle):
  // flip `open` so the slide-out animation plays, then unmount + remove the host
  // after it finishes. Removing the host is what lets the icon reopen the drawer.
  const closingRef = useRef(false)
  function close() {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    setTimeout(onClose, 240)  // > the 0.22s slide-out in SHEET_CSS
  }

  closeRef.current = close

  // Radix fires this for user-initiated closes (overlay click, Esc).
  function handleOpenChange(next: boolean) {
    if (!next) close()
  }

  // Close on an outside click. composedPath() crosses the shadow-DOM boundary
  // correctly (Radix's portal outside-detection is unreliable here, so it's
  // disabled via onInteractOutside and handled manually). Uses mousedown, not
  // wheel, so the page stays scrollable without closing the drawer.
  useEffect(() => {
    if (!open) return
    function onOutsideDown(e: MouseEvent) {
      if (!e.composedPath().includes(container)) close()
    }
    document.addEventListener('mousedown', onOutsideDown, true)
    return () => document.removeEventListener('mousedown', onOutsideDown, true)
  }, [open])

  function handleSignOut() {
    setShowAuthMenu(false)
    setUserEmail('')  // optimistic; the storage change flips isSignedIn → gate screen
    setUserName('')
    // chrome.identity is undefined in this content-script context, so the actual
    // token removal + flag clearing must happen in the background.
    const msg: SignOutMessage = { type: 'SIGN_OUT' }
    chrome.runtime.sendMessage(msg)
  }

  function handleDismissTrust() {
    chrome.storage.sync.set({ hasSeenTrustCard: true })
    setView('main')
  }

  // Name-first initial (matches how people expect their own avatar to read —
  // "S" for Sandeep, not for a possibly-unrelated email prefix), falling back
  // to email, then a generic account glyph for the rare pre-name-fetch moment.
  const initial = userName ? userName[0].toUpperCase() : (userEmail ? userEmail[0].toUpperCase() : (isSignedIn ? 'G' : ''))

  return (
    <>
      <style>{POPUP_CSS}</style>
      <style>{SHEET_CSS}</style>
      <style>{BODY_CSS}</style>
      {/* Non-modal: SnipKeep is a companion drawer — the page must stay scrollable
          and interactive while it's open (modal mode locks body scroll + traps focus). */}
      <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
        <SheetContent
          side="right"
          showClose={false}
          container={container}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader>
            {/* On first run the gate screen carries the branding — keep the title
                present for accessibility but hidden so it isn't duplicated. */}
            <SheetTitle className={isSignedIn ? undefined : 'cn-sr-only'}>
              <span className="cn-logo-mark">
                <Bookmark size={15} strokeWidth={2.5} />
              </span>
              Snip<span className="cn-accent">Keep</span>
            </SheetTitle>

            <div className="cn-header-actions">
              {initial && (
                // A <button> can never contain another <button> (invalid HTML —
                // see the .cn-avatar-wrap comment in BODY_CSS for the bug this
                // fixed), so the trigger and its dropdown are siblings under one
                // positioned wrapper, not parent/child.
                <div className="cn-avatar-wrap" ref={avatarRef}>
                  <button
                    className="cn-avatar"
                    onClick={() => setShowAuthMenu(v => !v)}
                    title={userName || userEmail || 'Google Account'}
                  >
                    {initial}
                  </button>
                  {showAuthMenu && (
                    <div className="cn-auth-dropdown">
                      {/* Identity block: a real avatar circle (same initial as the
                          header trigger, given actual size/presence here) beside
                          name (primary) + email (secondary) — one grouped fact,
                          then a divider into actions (Jakob's Law: mirrors the
                          identity-then-actions shape of Google's own account
                          menu, so it needs no learning). */}
                      <div className="cn-auth-identity">
                        <div className="cn-auth-avatar">{initial}</div>
                        <div className="cn-auth-text">
                          {userName && <div className="cn-auth-name">{userName}</div>}
                          <div className="cn-auth-email">{userEmail}</div>
                        </div>
                      </div>
                      <button
                        className="cn-auth-privacy"
                        onClick={() => { setView('privacy'); setShowAuthMenu(false) }}
                      >
                        <MdLock size={13} /> Privacy
                      </button>
                      <button className="cn-auth-signout" onClick={handleSignOut}>
                        <MdLogout size={13} /> Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button className="cn-sheet-close-btn" onClick={close} title="Close (Esc)">
                <MdClose size={15} />
              </button>
            </div>
          </SheetHeader>

          <div className="cn-body">
            <div className="cn-popup-root">
              {view === 'trust' ? (
                <TrustCard firstDocId={firstDocId} onDismiss={handleDismissTrust} />
              ) : view === 'privacy' ? (
                <PrivacyLedger onBack={() => setView('main')} onShowTrust={() => setView('trust')} />
              ) : (
                <Popup />
              )}
            </div>

            {isSignedIn && view === 'main' && (
              <div className="cn-footer">
                <span className="cn-kbd"><MdKeyboardReturn size={12} /></span>
                <span className="cn-footer-text">to clip any selection</span>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
