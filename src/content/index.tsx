import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toolbar } from './Toolbar'
import { Drawer } from './Drawer'
import { ensureFontLoaded } from '../lib/fonts'
import type {
  Destination,
  DocDestination,
  NotionConfig,
  LinkSpan,
  SaveNoteMessage,
  SaveNoteResponse,
  SaveImageMessage,
  SaveImageResponse,
  CaptureImageMessage,
  TriggerSaveMessage,
  ToggleDrawerMessage,
  ToolbarApi,
} from '../types'

const HOST_ID = 'snipkeep-host'
const DRAWER_HOST_ID = 'snipkeep-drawer-host'
const TOAST_ID = 'snipkeep-toast'
const DEBOUNCE_MS = 250
const TOOLBAR_HEIGHT = 44
const GAP = 8

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeRoot: ReactDOM.Root | null = null
let drawerRoot: ReactDOM.Root | null = null
const drawerCloseRef: React.MutableRefObject<(() => void) | null> = { current: null }
// Set by the mounted Toolbar so page-level key presses can drive it (Enter/←/→).
const toolbarApiRef: React.MutableRefObject<ToolbarApi | null> = { current: null }
let activeHost: HTMLElement | null = null

// The innermost element a key event actually targets — reaches through shadow
// roots (a plain `e.target` is retargeted to the shadow host from a document listener).
function deepTarget(e: Event): Element | null {
  const path = e.composedPath()
  return (path[0] as Element) ?? null
}

// True when keystrokes belong to the element (typing) and must not be hijacked.
function isEditableTarget(node: Element | null): boolean {
  if (!node || !(node instanceof HTMLElement)) return false
  const tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return node.isContentEditable
}

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

// ── Lecture-timestamp clipping (YouTube) ─────────────────────────────────────
// On a YouTube watch page, a clip carries the video moment it came from, so
// the Source link (and the timestamp written into the Doc) reopens the
// lecture at that exact minute. The returned url is CANONICALIZED (t/start
// stripped) — sourceUrl doubles as the page's identity for article-grouping,
// Works Cited dedup, and archiving, so per-clip time params must never live
// in it; the moment travels separately as `videoTime`.
//
// The moment itself, best first:
//  1. The transcript line the selection sits in — each transcript segment
//     carries its own timestamp in the DOM, precise to the sentence, and
//     independent of where playback happens to be paused.
//  2. The player's current playback time, floored (ignored when < 1s — a
//     video that was never played says nothing about the clip).
// Everything is best-effort behind try/catch: YouTube's DOM is theirs to
// change, and a failed detection just means a normal, untimed clip.
function getVideoClipContext(range: Range | null): { url: string; videoTime?: number } {
  const href = window.location.href
  try {
    const u = new URL(href)
    const isWatch = /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch'
    if (!isWatch) return { url: href }
    u.searchParams.delete('t')
    u.searchParams.delete('start')
    const url = u.toString()

    const anchor = range?.startContainer
    const el = anchor
      ? (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement)
      : null
    const stampText = el
      ?.closest('ytd-transcript-segment-renderer')
      ?.querySelector('.segment-timestamp')
      ?.textContent?.trim()
    if (stampText && /^\d+(:\d{1,2})+$/.test(stampText)) {
      const seconds = stampText.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
      return { url, videoTime: seconds }
    }

    const t = document.querySelector('video')?.currentTime ?? 0
    return t >= 1 ? { url, videoTime: Math.floor(t) } : { url }
  } catch {
    return { url: href }
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function removeToolbar() {
  if (activeRoot) { activeRoot.unmount(); activeRoot = null }
  if (activeHost) { activeHost.remove(); activeHost = null }
  toolbarApiRef.current = null
}

async function showToolbar(rect: DOMRect, text: string, links: LinkSpan[], videoCtx: { url: string; videoTime?: number }) {
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
      apiRef={toolbarApiRef}
      onSave={async (destId, destType, note) => {
        const msg: SaveNoteMessage = {
          type: 'SAVE_NOTE',
          // videoCtx was captured when the toolbar appeared — the selection
          // (and its transcript line) may be gone by the time Save is clicked.
          payload: {
            text, url: videoCtx.url, title: document.title,
            destinationId: destId, destinationType: destType, note, links,
            ...(videoCtx.videoTime !== undefined ? { videoTime: videoCtx.videoTime } : {}),
          },
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
    background: #1C1A24; border: 1px solid #2A2635; border-radius: 10px;
    padding: 11px 16px; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; font-weight: 600; letter-spacing: -0.1px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    animation: cn-toast-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    pointer-events: none;
  }
  .toast.success { color: #A99CFF; }
  .toast.error   { color: #FF8A8A; }
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

// Find each hyperlink inside the selection and locate its text within the already
// normalized clip, recording {start, end, url}. Low-risk by design: it doesn't
// rebuild the clip text, it just searches for each anchor's text inside it.
function extractLinkSpans(range: Range, normalizedText: string): LinkSpan[] {
  const frag = range.cloneContents()
  const anchors = Array.from(frag.querySelectorAll('a[href]')) as HTMLAnchorElement[]
  const spans: LinkSpan[] = []
  let searchFrom = 0

  for (const a of anchors) {
    const url = a.href  // resolves to absolute against the page's base URI
    if (!/^https?:\/\//i.test(url)) continue
    const linkText = normalizeSelectionText(a.textContent ?? '')
    if (!linkText) continue

    let idx = normalizedText.indexOf(linkText, searchFrom)
    if (idx === -1) idx = normalizedText.indexOf(linkText)  // fall back to a fresh scan
    if (idx === -1) continue

    spans.push({ start: idx, end: idx + linkText.length, url })
    searchFrom = idx + linkText.length
  }
  return spans
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

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return

    await showToolbar(rect, text, extractLinkSpans(range, text), getVideoClipContext(range))
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
  // Pass container so SheetPortal renders inside the shadow DOM, not document.body
  root.render(<Drawer container={container} onClose={closeDrawer} closeRef={drawerCloseRef} />)
  drawerRoot = root
}

// ── Init guard ──────────────────────────────────────────────────────────────
// The content script can arrive two ways: auto-injected by the manifest (pages
// loaded after install) or injected on demand by the background (pre-existing
// tabs). If both ever land in the same page, re-registering listeners would make
// the drawer open-then-close. Run the setup at most once per page.
const w = window as unknown as { __snipkeepLoaded?: boolean }
if (!w.__snipkeepLoaded) {
  w.__snipkeepLoaded = true
  init()
}

function init() {

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

  // The background can't know which frame the user's selection is actually
  // in (chrome.commands has no frame info), so this broadcasts to every
  // frame (content scripts now run in all_frames). document.hasFocus() is
  // what disambiguates: only the frame the user was last interacting with —
  // where a selection would actually live — reports true. Every other frame
  // on the page silently no-ops instead of showing a spurious "no text
  // selected" toast of its own.
  if (!document.hasFocus()) return

  const selection = window.getSelection()
  const text = normalizeSelectionText(selection?.toString() ?? '')
  if (!text) { showToast('No text selected', 'error'); return }

  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const links = range ? extractLinkSpans(range, text) : []
  const videoCtx = getVideoClipContext(range)

  loadDestinations().then(({ destinations, defaultDestId }) => {
    const dest = destinations.find(d => d.id === defaultDestId) ?? destinations[0]
    if (!dest) { showToast('No destination set', 'error'); return }

    const msg: SaveNoteMessage = {
      type: 'SAVE_NOTE',
      payload: {
        text, url: videoCtx.url, title: document.title,
        destinationId: dest.id, destinationType: dest.type, links,
        ...(videoCtx.videoTime !== undefined ? { videoTime: videoCtx.videoTime } : {}),
      },
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

// Right-click "Save image to SnipKeep" — the background routes the click here so
// we can read the image's natural size and page title before saving.
chrome.runtime.onMessage.addListener((message: CaptureImageMessage) => {
  if (message.type !== 'CAPTURE_IMAGE') return

  const src = message.srcUrl
  if (/^(data|blob):/i.test(src)) {
    showToast("Can't save this image (not a public URL)", 'error')
    return
  }

  const img = Array.from(document.images).find(im => im.currentSrc === src || im.src === src)
  const width = img?.naturalWidth || undefined
  const height = img?.naturalHeight || undefined

  loadDestinations().then(({ destinations, defaultDestId }) => {
    const dest = destinations.find(d => d.id === defaultDestId) ?? destinations[0]
    if (!dest) { showToast('No destination set', 'error'); return }

    const msg: SaveImageMessage = {
      type: 'SAVE_IMAGE',
      payload: {
        imageUrl: src, width, height,
        url: window.location.href, title: document.title,
        destinationId: dest.id, destinationType: dest.type,
      },
    }

    chrome.runtime.sendMessage(msg, (res: SaveImageResponse) => {
      if (res?.success) showToast(`✓ Image saved to ${dest.name}`, 'success')
      else showToast(res?.error ?? 'Save failed', 'error')
    })
  })
})

// Register the bundled font once at startup so the toolbar, toast and drawer
// all render in Plus Jakarta Sans regardless of which appears first.
ensureFontLoaded()

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onMouseDown)
// Capture phase so we can act before the page's own key handlers/scrolling.
document.addEventListener('keydown', onGlobalKeyDown, true)

}

// Page-level keyboard control of the floating toolbar. Only active while the
// toolbar is showing; never touches keys typed into inputs/editors or events
// that originate inside the toolbar (its own note field handles those).
function onGlobalKeyDown(e: KeyboardEvent) {
  const host = document.getElementById(HOST_ID)
  if (!host || !toolbarApiRef.current) return
  if (e.composedPath().includes(host)) return        // focus/typing inside the toolbar
  if (isEditableTarget(deepTarget(e))) return         // typing in a page field
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Enter' && e.repeat) return           // ignore key-repeat while held

  if (e.key !== 'Enter' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return

  const consumed = toolbarApiRef.current.handleNavKey(e.key)
  if (consumed) {
    e.preventDefault()
    e.stopPropagation()
  }
}
