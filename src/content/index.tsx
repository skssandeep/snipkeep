import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toolbar } from './Toolbar'
import { Drawer } from './Drawer'
import type {
  Destination,
  DocDestination,
  NotionConfig,
  SaveNoteMessage,
  SaveNoteResponse,
  TriggerSaveMessage,
  ToggleDrawerMessage,
} from '../types'

const HOST_ID = 'clipnote-host'
const DRAWER_HOST_ID = 'clipnote-drawer-host'
const TOAST_ID = 'clipnote-toast'
const DEBOUNCE_MS = 250
const TOOLBAR_HEIGHT = 44
const GAP = 8

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeRoot: ReactDOM.Root | null = null
let drawerRoot: ReactDOM.Root | null = null
const drawerCloseRef: React.MutableRefObject<(() => void) | null> = { current: null }
let activeHost: HTMLElement | null = null

// ── Destinations ──────────────────────────────────────────────────────────────

async function loadDestinations(): Promise<{ destinations: Destination[]; defaultDestId: string }> {
  const result = await chrome.storage.sync.get(['docs', 'docId', 'notionConfig', 'defaultDestId'])

  let docs: DocDestination[] = (result.docs as DocDestination[]) ?? []
  if (docs.length === 0 && result.docId) {
    docs = [{ id: result.docId as string, name: 'My Notes', active: true }]
  }

  // Only surface docs the user has toggled on for this session
  const destinations: Destination[] = docs
    .filter(d => d.active !== false)
    .map(d => ({ id: d.id, name: d.name, type: 'gdoc' }))

  const notionConfig = result.notionConfig as NotionConfig | undefined
  if (notionConfig?.token && notionConfig?.pageId) {
    destinations.push({
      id: 'notion',
      name: notionConfig.pageName ?? 'Notion',
      type: 'notion',
    })
  }

  const defaultDestId = (result.defaultDestId as string) ?? destinations[0]?.id ?? ''
  return { destinations, defaultDestId }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function removeToolbar() {
  if (activeRoot) { activeRoot.unmount(); activeRoot = null }
  if (activeHost) { activeHost.remove(); activeHost = null }
}

async function showToolbar(rect: DOMRect, text: string) {
  removeToolbar()

  const { destinations, defaultDestId } = await loadDestinations()
  if (destinations.length === 0) return

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
      destinations={destinations}
      defaultDestId={defaultDestId}
      onSave={async (destId, destType) => {
        const msg: SaveNoteMessage = {
          type: 'SAVE_NOTE',
          payload: { text, url: window.location.href, title: document.title, destinationId: destId, destinationType: destType },
        }
        const res: SaveNoteResponse = await chrome.runtime.sendMessage(msg)
        if (!res.success) throw new Error(res.error ?? 'Save failed')
        // Persist chosen destination as the new default
        await chrome.storage.sync.set({ defaultDestId: destId })
      }}
      onDismiss={removeToolbar}
    />
  )

  activeRoot = root
  activeHost = host
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const TOAST_STYLES = `
  @keyframes cn-toast-in  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cn-toast-out { from { opacity: 1; } to { opacity: 0; } }
  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: #1a1a1a; border: 1px solid #2e2e2e; border-radius: 8px;
    padding: 10px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; font-weight: 500;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    animation: cn-toast-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    pointer-events: none;
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
  Object.assign(host.style, { position: 'fixed', bottom: '0', right: '0', width: '0', height: '0', overflow: 'visible', zIndex: '2147483647', pointerEvents: 'none' })
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${TOAST_STYLES}</style><div class="toast ${type}">${message}</div>`

  setTimeout(() => {
    const toast = shadow.querySelector('.toast')
    if (toast) {
      toast.classList.add('fade-out')
      setTimeout(() => host.remove(), 200)
    }
  }, 1800)
}

// ── Event listeners ───────────────────────────────────────────────────────────

// Single \n = visual line wrap (large heading, narrow container) → join with space.
// Double \n = true paragraph break → keep as \n so each paragraph becomes its own bullet.
function normalizeSelectionText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\x00')  // protect paragraph breaks
    .replace(/\n/g, ' ')          // collapse visual wraps into a space
    .replace(/\x00/g, '\n')       // restore paragraph breaks
    .replace(/ {2,}/g, ' ')       // clean up any double spaces
    .trim()
}

function onMouseUp(e: MouseEvent) {
  // Ignore clicks that originated inside the toolbar — prevents the dropdown
  // from being wiped when the user clicks the ▾ chevron or a dropdown item.
  const host = document.getElementById(HOST_ID)
  if (host && e.composedPath().includes(host)) return

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const selection = window.getSelection()
    const text = normalizeSelectionText(selection?.toString() ?? '')
    if (!text || !selection || selection.rangeCount === 0) return

    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return

    await showToolbar(rect, text)
  }, DEBOUNCE_MS)
}

function onMouseDown(e: MouseEvent) {
  const host = document.getElementById(HOST_ID)
  if (host && !e.composedPath().includes(host)) removeToolbar()
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function closeDrawer() {
  drawerCloseRef.current = null
  if (drawerRoot) { drawerRoot.unmount(); drawerRoot = null }
  const host = document.getElementById(DRAWER_HOST_ID)
  if (host) host.remove()
}

function openDrawer() {
  const host = document.createElement('div')
  host.id = DRAWER_HOST_ID
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const container = document.createElement('div')
  shadow.appendChild(container)

  const root = ReactDOM.createRoot(container)
  root.render(<Drawer onClose={closeDrawer} closeRef={drawerCloseRef} />)
  drawerRoot = root
}

// ── Message listeners ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ToggleDrawerMessage | TriggerSaveMessage) => {
  if (message.type === 'TOGGLE_DRAWER') {
    if (document.getElementById(DRAWER_HOST_ID)) {
      // Drawer is open — trigger animated slide-out via the ref the component exposed
      drawerCloseRef.current ? drawerCloseRef.current() : closeDrawer()
    } else {
      openDrawer()
    }
    return
  }
})

// Keyboard shortcut — save directly with toast feedback
chrome.runtime.onMessage.addListener((message: TriggerSaveMessage) => {
  if (message.type !== 'TRIGGER_SAVE') return

  const selection = window.getSelection()
  const text = normalizeSelectionText(selection?.toString() ?? '')
  if (!text) { showToast('No text selected', 'error'); return }

  loadDestinations().then(({ destinations, defaultDestId }) => {
    const dest = destinations.find(d => d.id === defaultDestId) ?? destinations[0]
    if (!dest) { showToast('No destination set', 'error'); return }

    const msg: SaveNoteMessage = {
      type: 'SAVE_NOTE',
      payload: { text, url: window.location.href, title: document.title, destinationId: dest.id, destinationType: dest.type },
    }

    chrome.runtime.sendMessage(msg, (res: SaveNoteResponse) => {
      if (res?.success) {
        showToast(`✓ Saved to ${dest.name}`, 'success')
        removeToolbar()
      } else {
        showToast(res?.error ?? 'Save failed', 'error')
      }
    })
  })
})

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onMouseDown)
