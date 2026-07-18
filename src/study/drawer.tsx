import React from 'react'
import ReactDOM from 'react-dom/client'
import { Drawer } from '../content/Drawer'
import type { ToggleDrawerMessage } from '../types'

// The study page is an extension page, so the content script never runs here
// (Chrome can't inject into chrome-extension:// URLs) — but the icon-click
// TOGGLE_DRAWER that the background sends via chrome.tabs.sendMessage IS
// delivered to this page's runtime.onMessage (extension frames in a tab
// receive tab messages too, frameId 0 = this main frame). So the drawer works
// here by re-registering the same listener + mount that content/index.tsx
// uses, reusing the Drawer component untouched — including its Shadow DOM
// host, which isolates the popup's own CSS from study.css.
const DRAWER_HOST_ID = 'snipkeep-drawer-host'

let drawerRoot: ReactDOM.Root | null = null
const drawerCloseRef: React.MutableRefObject<(() => void) | null> = { current: null }

function closeDrawer() {
  drawerCloseRef.current = null
  if (drawerRoot) { drawerRoot.unmount(); drawerRoot = null }
  document.getElementById(DRAWER_HOST_ID)?.remove()
}

function openDrawer() {
  const host = document.createElement('div')
  host.id = DRAWER_HOST_ID
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const container = document.createElement('div')
  shadow.appendChild(container)

  const root = ReactDOM.createRoot(container)
  root.render(<Drawer container={container} onClose={closeDrawer} closeRef={drawerCloseRef} />)
  drawerRoot = root
}

// For the page's own CTAs (e.g. the connect-AI hint) — same drawer the icon
// click opens, just triggered from inside the page.
export function openDrawerFromPage() {
  if (!document.getElementById(DRAWER_HOST_ID)) openDrawer()
}

export function initDrawerToggle() {
  chrome.runtime.onMessage.addListener((message: ToggleDrawerMessage) => {
    if (message.type !== 'TOGGLE_DRAWER') return
    if (document.getElementById(DRAWER_HOST_ID)) {
      drawerCloseRef.current ? drawerCloseRef.current() : closeDrawer()
    } else {
      openDrawer()
    }
  })
}
