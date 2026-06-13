import type { SaveNoteMessage, SaveNoteResponse, TriggerSaveMessage } from '../types'

const DOCS_API = 'https://docs.googleapis.com/v1/documents'
const LINK_CHAR = '[source]'
const LINK_COLOR = { red: 0.29, green: 0.56, blue: 0.89 }

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

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries === 0) throw err
    await new Promise(r => setTimeout(r, 500))
    return withRetry(fn, retries - 1)
  }
}

// chrome.storage.session persists across service worker restarts within a browser session.
// In-memory variables reset whenever Chrome kills the background worker — session storage doesn't.
async function getLastSavedUrl(): Promise<string> {
  const result = await chrome.storage.session.get(['lastSavedUrl'])
  return (result.lastSavedUrl as string) ?? ''
}

async function appendToDoc(
  docId: string,
  token: string,
  text: string,
  pageTitle: string,
  pageUrl: string
) {
  const lastSavedUrl = await getLastSavedUrl()
  const isNewArticle = pageUrl !== lastSavedUrl

  // GET current doc to find the body end index
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

  // insertText with endOfSegmentLocation inserts just before the document's final \n
  const insertionPoint = endIndex - 1
  const requests: object[] = []

  if (isNewArticle) {
    // New source: add a Heading 2 with the page title (↗ is a link on the heading).
    // Format: "Page Title ↗\n\nClip text\n\n"
    // The heading appears once per source — subsequent clips skip it.
    const headingLine = `${pageTitle} ${LINK_CHAR}\n`
    const insertText = `${headingLine}\n${text}\n\n`

    const headingEnd = insertionPoint + headingLine.length
    const linkStart = insertionPoint + pageTitle.length + 1 // after "pageTitle "
    const linkEnd = linkStart + LINK_CHAR.length

    requests.push(
      {
        insertText: {
          endOfSegmentLocation: { segmentId: '' },
          text: insertText,
        },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: insertionPoint, endIndex: headingEnd },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType',
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: linkStart, endIndex: linkEnd },
          textStyle: {
            link: { url: pageUrl },
            foregroundColor: { color: { rgbColor: LINK_COLOR } },
            fontSize: { magnitude: 9, unit: 'PT' },
            underline: false,
          },
          fields: 'link,foregroundColor,fontSize,underline',
        },
      }
    )
  } else {
    // Same source: just append the clip — the heading above already attributes it.
    requests.push({
      insertText: {
        endOfSegmentLocation: { segmentId: '' },
        text: `${text}\n\n`,
      },
    })
  }

  const batchRes = await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  })

  if (!batchRes.ok) {
    const body = await batchRes.text()
    throw new Error(`Docs API batchUpdate ${batchRes.status}: ${body}`)
  }

  await chrome.storage.session.set({ lastSavedUrl: pageUrl })
}

async function handleSave(payload: { text: string; url: string; title: string }) {
  const { docId } = await chrome.storage.sync.get(['docId'])

  if (!docId) {
    throw new Error('No document set. Open ClipNote settings and paste your Doc ID.')
  }

  const token = await getAuthToken()
  await withRetry(() => appendToDoc(docId, token, payload.text, payload.title, payload.url))
}

// Toolbar "Save to Notes" button
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

// Keyboard shortcut: Cmd+Shift+S (mac) / Ctrl+Shift+S (windows)
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'save-selection') return

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (!tabId) return
    const msg: TriggerSaveMessage = { type: 'TRIGGER_SAVE' }
    chrome.tabs.sendMessage(tabId, msg)
  })
})
