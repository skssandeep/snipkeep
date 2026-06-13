import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toolbar } from './Toolbar'
import type { SaveNoteMessage, SaveNoteResponse } from '../types'

const HOST_ID = 'clipnote-host'
const DEBOUNCE_MS = 250
const TOOLBAR_HEIGHT = 44
const GAP = 8

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeRoot: ReactDOM.Root | null = null
let activeHost: HTMLElement | null = null

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

  // Position above the selection; flip below if there's no room
  let top = rect.top + scrollY - TOOLBAR_HEIGHT - GAP
  if (top < scrollY + 8) {
    top = rect.bottom + scrollY + GAP
  }

  // Horizontally centred on the selection
  const left = rect.left + scrollX + rect.width / 2

  const host = document.createElement('div')
  host.id = HOST_ID
  // The host is a zero-size anchor; the toolbar overflows it visually
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

  // Shadow DOM keeps our styles from leaking into or out of the host page
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
  // composedPath pierces the Shadow DOM boundary
  if (host && !e.composedPath().includes(host)) {
    removeToolbar()
  }
}

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onMouseDown)
