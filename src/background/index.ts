import type {
  DocDestination,
  NotionConfig,
  HistoryEntry,
  SaveNoteMessage,
  SaveNoteResponse,
  TriggerSaveMessage,
  ToggleDrawerMessage,
} from '../types'

const DOCS_API = 'https://docs.googleapis.com/v1/documents'
const NOTION_API = 'https://api.notion.com/v1'
const PILL_FG   = { red: 0.20, green: 0.46, blue: 0.80 }
const PILL_BG   = { red: 0.88, green: 0.93, blue: 1.00 }

// ── Auth ─────────────────────────────────────────────────────────────────────

function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Authentication failed'))
        return
      }
      resolve(token)
    })
  })
}

// ── Retry ─────────────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries === 0) throw err
    await new Promise(r => setTimeout(r, 500))
    return withRetry(fn, retries - 1)
  }
}

// ── Per-destination URL tracking ──────────────────────────────────────────────
// Keyed by destinationId so each doc/notion page tracks its own "last saved from" URL.
// chrome.storage.session survives service worker restarts within a browser session.

type LastSavedUrls = Record<string, string>

async function getLastSavedUrl(destId: string): Promise<string> {
  const result = await chrome.storage.session.get(['lastSavedUrls'])
  const map = (result.lastSavedUrls as LastSavedUrls) ?? {}
  return map[destId] ?? ''
}

async function setLastSavedUrl(destId: string, url: string) {
  const result = await chrome.storage.session.get(['lastSavedUrls'])
  const map = (result.lastSavedUrls as LastSavedUrls) ?? {}
  map[destId] = url
  await chrome.storage.session.set({ lastSavedUrls: map })
}

// ── History ───────────────────────────────────────────────────────────────────

async function addToHistory(entry: HistoryEntry) {
  const result = await chrome.storage.local.get(['history'])
  const history = (result.history as HistoryEntry[]) ?? []
  history.unshift(entry)
  if (history.length > 10) history.splice(10)
  await chrome.storage.local.set({ history })
}

// ── Google Docs ───────────────────────────────────────────────────────────────

async function appendToGoogleDoc(
  docId: string,
  token: string,
  text: string,
  pageTitle: string,
  pageUrl: string,
  isNewArticle: boolean
) {
  const docRes = await fetch(`${DOCS_API}/${docId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!docRes.ok) {
    const body = await docRes.text()
    throw new Error(`Docs API GET ${docRes.status}: ${body}`)
  }
  const doc = await docRes.json()
  const bodyContent = doc.body.content
  const endIndex: number = bodyContent[bodyContent.length - 1].endIndex
  const insertionPoint = endIndex - 1
  const requests: object[] = []

  if (isNewArticle) {
    const domain = new URL(pageUrl).hostname.replace(/^www\./, '')
    // Structure: heading, pill on its own line, blank gap, then bulleted text
    const headingLine = `${pageTitle}\n`
    const pillLine    = ` ${domain} \n`  // spaces give visual padding inside the bg highlight
    const insertText  = `${headingLine}${pillLine}\n${text}\n\n`

    const headingEnd = insertionPoint + headingLine.length
    const pillStart  = headingEnd
    const pillEnd    = pillStart + pillLine.length - 1  // exclude trailing \n
    const textStart  = insertionPoint + headingLine.length + pillLine.length + 1  // after the blank \n
    const textEnd    = textStart + text.length + 1  // include the paragraph-ending \n for bullet range

    requests.push(
      { insertText: { endOfSegmentLocation: { segmentId: '' }, text: insertText } },
      {
        updateParagraphStyle: {
          range: { startIndex: insertionPoint, endIndex: headingEnd },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType',
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: pillStart, endIndex: pillEnd },
          textStyle: {
            link: { url: pageUrl },
            foregroundColor: { color: { rgbColor: PILL_FG } },
            backgroundColor: { color: { rgbColor: PILL_BG } },
            fontSize: { magnitude: 9, unit: 'PT' },
            bold: false,
            underline: false,
          },
          fields: 'link,foregroundColor,backgroundColor,fontSize,bold,underline',
        },
      },
      {
        createParagraphBullets: {
          range: { startIndex: textStart, endIndex: textEnd },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      }
    )
  } else {
    // Continuing the same article — just append another bullet
    const insertText = `${text}\n\n`
    const textEnd    = insertionPoint + text.length + 1

    requests.push(
      { insertText: { endOfSegmentLocation: { segmentId: '' }, text: insertText } },
      {
        createParagraphBullets: {
          range: { startIndex: insertionPoint, endIndex: textEnd },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      }
    )
  }

  const batchRes = await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })

  if (!batchRes.ok) {
    const body = await batchRes.text()
    throw new Error(`Docs API batchUpdate ${batchRes.status}: ${body}`)
  }
}

// ── Notion ────────────────────────────────────────────────────────────────────

async function appendToNotion(
  token: string,
  pageId: string,
  text: string,
  pageTitle: string,
  pageUrl: string,
  isNewArticle: boolean
) {
  const children: object[] = []

  if (isNewArticle) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [
          { type: 'text', text: { content: pageTitle } },
          {
            type: 'text',
            text: { content: ' [source]', link: { url: pageUrl } },
            annotations: { color: 'blue' },
          },
        ],
      },
    })
  }

  children.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  })

  const res = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ children }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Notion API ${res.status}: ${body}`)
  }
}

// ── Main save handler ─────────────────────────────────────────────────────────

async function handleSave(payload: SaveNoteMessage['payload']) {
  const { text, url, title, destinationId, destinationType } = payload

  const storage = await chrome.storage.sync.get(['docs', 'docId', 'notionConfig'])

  // Migrate legacy single-doc storage to the docs array format
  let docs: DocDestination[] = storage.docs ?? []
  if (docs.length === 0 && storage.docId) {
    docs = [{ id: storage.docId as string, name: 'My Notes' }]
  }

  const isNewArticle = (await getLastSavedUrl(destinationId)) !== url
  let destinationName = 'Notes'

  if (destinationType === 'gdoc') {
    const doc = docs.find(d => d.id === destinationId)
    if (!doc) throw new Error('Document not found. Check your ClipNote settings.')
    destinationName = doc.name

    const token = await getAuthToken()
    await withRetry(() => appendToGoogleDoc(doc.id, token, text, title, url, isNewArticle))
  } else {
    const notionConfig = storage.notionConfig as NotionConfig | undefined
    if (!notionConfig?.token) throw new Error('Notion not configured. Open ClipNote settings.')
    destinationName = notionConfig.pageName ?? 'Notion'

    await withRetry(() =>
      appendToNotion(notionConfig.token, notionConfig.pageId, text, title, url, isNewArticle)
    )
  }

  await setLastSavedUrl(destinationId, url)

  await addToHistory({
    text: text.slice(0, 150),
    sourceTitle: title,
    sourceUrl: url,
    destinationName,
    savedAt: Date.now(),
  })
}

// ── Message listeners ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: SaveNoteMessage, _sender, sendResponse: (r: SaveNoteResponse) => void) => {
    if (message.type !== 'SAVE_NOTE') return false

    ;(async () => {
      try {
        await handleSave(message.payload)
        sendResponse({ success: true })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error('[ClipNote]', error)
        sendResponse({ success: false, error })
      }
    })()

    return true
  }
)

// Extension icon click → toggle the right-side drawer
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return
  const msg: ToggleDrawerMessage = { type: 'TOGGLE_DRAWER' }
  chrome.tabs.sendMessage(tab.id, msg)
})

// Keyboard shortcut: Cmd+Shift+S
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'save-selection') return

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (!tabId) return
    const msg: TriggerSaveMessage = { type: 'TRIGGER_SAVE' }
    chrome.tabs.sendMessage(tabId, msg)
  })
})
