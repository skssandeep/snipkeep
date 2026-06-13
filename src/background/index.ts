import type { SaveNoteMessage, SaveNoteResponse } from '../types'

const DOCS_API = 'https://docs.googleapis.com/v1/documents'

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

async function appendToDoc(
  docId: string,
  token: string,
  text: string,
  pageTitle: string,
  pageUrl: string
) {
  // Step 1: GET the document to find the current body end index.
  // We need this to calculate the exact position of the link icon after insertion.
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

  // Format: selected text, then attribution line with a linked ↗ icon instead of raw URL
  const LINK_CHAR = '↗'
  const prefix = `${text}\n— ${pageTitle} `
  const noteText = `${prefix}${LINK_CHAR}\n\n`

  // insertText with endOfSegmentLocation inserts just before the document's final \n (at endIndex - 1)
  const insertionPoint = endIndex - 1
  const linkStart = insertionPoint + prefix.length
  const linkEnd = linkStart + LINK_CHAR.length

  // Step 2: Insert the text and apply a hyperlink to just the ↗ icon in one batch
  const batchRes = await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            endOfSegmentLocation: { segmentId: '' },
            text: noteText,
          },
        },
        {
          updateTextStyle: {
            range: { startIndex: linkStart, endIndex: linkEnd },
            textStyle: {
              link: { url: pageUrl },
              foregroundColor: {
                color: { rgbColor: { red: 0.29, green: 0.56, blue: 0.89 } },
              },
              underline: false,
            },
            fields: 'link,foregroundColor,underline',
          },
        },
      ],
    }),
  })

  if (!batchRes.ok) {
    const body = await batchRes.text()
    throw new Error(`Docs API batchUpdate ${batchRes.status}: ${body}`)
  }
}

chrome.runtime.onMessage.addListener(
  (message: SaveNoteMessage, _sender, sendResponse: (r: SaveNoteResponse) => void) => {
    if (message.type !== 'SAVE_NOTE') return false

    ;(async () => {
      try {
        const { docId } = await chrome.storage.sync.get(['docId'])

        if (!docId) {
          sendResponse({
            success: false,
            error: 'No document set. Open ClipNote settings and paste your Doc ID.',
          })
          return
        }

        const token = await getAuthToken()
        await appendToDoc(
          docId,
          token,
          message.payload.text,
          message.payload.title,
          message.payload.url
        )

        sendResponse({ success: true })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error('[ClipNote background]', error)
        sendResponse({ success: false, error })
      }
    })()

    // Return true to keep the message channel open while the async work runs
    return true
  }
)
