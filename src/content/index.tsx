import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toolbar } from './Toolbar'
import type { SaveNoteMessage, SaveNoteResponse, TriggerSaveMessage } from '../types'

const HOST_ID = 'clipnote-host'
const TOAST_ID = 'clipnote-toast'
const DEBOUNCE_MS = 250
const TOOLBAR_HEIGHT = 44
const GAP = 8

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeRoot: ReactDOM.Root | null = null
let activeHost: HTMLElement | null = null

// ── Toolbar ──────────────────────────────────────────────────────────────────

function removeToolbar() {
  if (activeRoot) {
    activeRoot.unmount()
    activeRoot = null
  }
  if (activeHost) {
    activeHost.remove()
    activeHost = null
  }
}

function showToolbar(rect: DOMRect, text: string) {
  removeToolbar()

  const scrollX = window.scrollX
  const scrollY = window.scrollY

  let top = rect.top + scrollY - TOOLBAR_HEIGHT - GAP
  if (top < scrollY + 8) top = rect.bottom + scrollY + GAP

  const left = rect.left + scrollX + rect.width / 2

  const host = document.createElement('div')
  host.id = HOST_ID
  Object.assign(host.style, {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    width: '0',
    height: '0',
    overflow: 'visible',
    zIndex: '2147483647',
    pointerEvents: 'none',
  })

  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const container = document.createElement('div')
  shadow.appendChild(container)

  const root = ReactDOM.createRoot(container)
  root.render(
    <Toolbar
      onSave={async () => {
        const msg: SaveNoteMessage = {
          type: 'SAVE_NOTE',
          payload: { text, url: window.location.href, title: document.title },
        }
        const res: SaveNoteResponse = await chrome.runtime.sendMessage(msg)
        if (!res.success) throw new Error(res.error ?? 'Save failed')
      }}
      onDismiss={removeToolbar}
    />
  )

  activeRoot = root
  activeHost = host
}

// ── Toast (keyboard shortcut feedback) ───────────────────────────────────────

const TOAST_STYLES = `
  @keyframes cn-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes cn-toast-out {
    from { opacity: 1; }
    to   { opacity: 0; }
  }
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1a1a1a;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    padding: 10px 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    animation: cn-toast-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    pointer-events: none;
    z-index: 2147483647;
  }
  .toast.success { color: #c8f135; }
  .toast.error   { color: #ff6b6b; }
  .toast.fade-out { animation: cn-toast-out 0.2s ease forwards; }
`

function showToast(message: string, type: 'success' | 'error') {
  const existing = document.getElementById(TOAST_ID)
  if (existing) existing.remove()

  const host = document.createElement('div')
  host.id = TOAST_ID
  Object.assign(host.style, {
    position: 'fixed',
    bottom: '0',
    right: '0',
    width: '0',
    height: '0',
    overflow: 'visible',
    zIndex: '2147483647',
    pointerEvents: 'none',
  })

  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>${TOAST_STYLES}</style>
    <div class="toast ${type}">${message}</div>
  `

  // Fade out then remove
  setTimeout(() => {
    const toast = shadow.querySelector('.toast')
    if (toast) {
      toast.classList.add('fade-out')
      setTimeout(() => host.remove(), 200)
    }
  }, 1800)
}

// ── Event listeners ───────────────────────────────────────────────────────────

function onMouseUp() {
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    const selection = window.getSelection()
    const text = selection?.toString().trim()

    if (!text || !selection || selection.rangeCount === 0) return

    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return

    showToolbar(rect, text)
  }, DEBOUNCE_MS)
}

function onMouseDown(e: MouseEvent) {
  const host = document.getElementById(HOST_ID)
  if (host && !e.composedPath().includes(host)) removeToolbar()
}

// Keyboard shortcut triggered by background service worker
chrome.runtime.onMessage.addListener((message: TriggerSaveMessage) => {
  if (message.type !== 'TRIGGER_SAVE') return

  const selection = window.getSelection()
  const text = selection?.toString().trim()

  if (!text) {
    showToast('No text selected', 'error')
    return
  }

  // Save immediately and show a toast — no toolbar interaction needed
  const msg: SaveNoteMessage = {
    type: 'SAVE_NOTE',
    payload: { text, url: window.location.href, title: document.title },
  }

  chrome.runtime.sendMessage(msg, (res: SaveNoteResponse) => {
    if (res?.success) {
      showToast('✓ Saved to Notes', 'success')
      removeToolbar()
    } else {
      showToast(res?.error ?? 'Save failed', 'error')
    }
  })
})

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onMouseDown)
