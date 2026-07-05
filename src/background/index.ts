import type {
  DocDestination,
  DocStats,
  NotionConfig,
  HistoryEntry,
  LinkSpan,
  SaveNoteMessage,
  SaveNoteResponse,
  SaveImageMessage,
  SaveImageResponse,
  CaptureImageMessage,
  TriggerSaveMessage,
  ToggleDrawerMessage,
  GetUserEmailMessage,
  GetUserEmailResponse,
  GetDocTitleMessage,
  GetDocTitleResponse,
  SignInMessage,
  SignInResponse,
  SignOutMessage,
  SignOutResponse,
  AddDocNoteMessage,
  AddDocNoteResponse,
} from '../types'

const DOCS_API = 'https://docs.googleapis.com/v1/documents'
const NOTION_API = 'https://api.notion.com/v1'
const LINK_FG    = { red: 0.20, green: 0.46, blue: 0.80 }  // domain hyperlink
const CAPTION_FG = { red: 0.50, green: 0.50, blue: 0.50 }  // grey source caption
const NOTE_FG    = { red: 0.42, green: 0.38, blue: 0.58 }  // muted violet — the reader's own voice
const NOTE_INDENT_PT = 18  // margin note sits indented under its clip

// Vertical rhythm (pt). Proximity: the between-block gap must dwarf every
// within-block gap, so each source reads as one tight unit.
const BLOCK_GAP_PT     = 30  // above a new article heading (separates blocks)
const HEADING_BELOW_PT = 3   // heading → caption (caption hugs its title)
const CAPTION_BELOW_PT = 14  // caption → first bullet (~one blank line)
const BULLET_BELOW_PT  = 2   // bullet → bullet (snug)

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

// Non-interactive — for background lookups that must never pop a sign-in prompt.
function getAuthTokenSilent(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) { resolve(null); return }
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
// Keyed by destinationId — each doc remembers the URL of its last clip so we know
// whether the next clip is a NEW article (emit heading) or a continuation (just a
// bullet). Stored in storage.local — must be durable: storage.session is wiped on
// browser/service-worker restart, which made the heading re-emit every session.

type LastSavedUrls = Record<string, string>

async function getLastSavedUrl(destId: string): Promise<string> {
  const result = await chrome.storage.local.get(['lastSavedUrls'])
  const map = (result.lastSavedUrls as LastSavedUrls) ?? {}
  return map[destId] ?? ''
}

async function setLastSavedUrl(destId: string, url: string) {
  const result = await chrome.storage.local.get(['lastSavedUrls'])
  const map = (result.lastSavedUrls as LastSavedUrls) ?? {}
  map[destId] = url
  await chrome.storage.local.set({ lastSavedUrls: map })
}

// ── Link-rot insurance ────────────────────────────────────────────────────────
// Keyed by the source PAGE url (not per-clip, not per-destination) — several
// clips from the same article share one snapshot, and re-clipping that page
// weeks later into a different doc won't re-request it. Best-effort only: never
// blocks or delays a save, and failure is silent (a dead site, a rate limit, or
// the service worker unloading mid-request just means no snapshot for that page).

type ArchivedUrls = Record<string, string>
const ARCHIVE_TIMEOUT_MS = 15_000

async function archiveSnapshot(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS)
  try {
    const saveUrl = `https://web.archive.org/save/${url}`
    const res = await fetch(saveUrl, { signal: controller.signal })
    if (!res.ok) return null
    // fetch follows the redirect chain; res.url is where it actually landed —
    // the permanent snapshot address (e.g. web.archive.org/web/<ts>/<url>).
    return res.url && res.url !== saveUrl ? res.url : null
  } catch {
    return null  // network error, timeout, or archive.org declined — fine, just skip it
  } finally {
    clearTimeout(timer)
  }
}

// Fire-and-forget: call after the real save has already succeeded. Skips pages
// that are already archived (or already attempted) instead of re-requesting.
async function ensureArchived(url: string) {
  const result = await chrome.storage.local.get(['archivedUrls'])
  const map = (result.archivedUrls as ArchivedUrls) ?? {}
  if (map[url]) return

  const snapshot = await archiveSnapshot(url)
  if (!snapshot) return

  const fresh = await chrome.storage.local.get(['archivedUrls'])
  const freshMap = (fresh.archivedUrls as ArchivedUrls) ?? {}
  freshMap[url] = snapshot
  await chrome.storage.local.set({ archivedUrls: freshMap })

  // Drop an "· archived" link next to every doc's caption for this page — a
  // page clipped into two different Docs gets the follow-up write in both.
  const bookmarks = await chrome.storage.local.get(['docCaptionBookmarks'])
  const captionMap = (bookmarks.docCaptionBookmarks as Record<string, Record<string, string>>) ?? {}
  const perDoc = captionMap[url] ?? {}
  await Promise.allSettled(
    Object.entries(perDoc).map(([destinationId, namedRangeId]) =>
      appendArchiveLinkToDoc(destinationId, namedRangeId, snapshot)
    )
  )
}

// ── Doc bookmarks (Google Docs NamedRange) ────────────────────────────────────
// A NamedRange marks a position in a Doc that Google keeps in sync as the doc
// is edited elsewhere — the reliable "remember a spot, come back and edit near
// it later" primitive both link-rot insurance and Living Resurface depend on.

async function resolveNamedRange(
  docId: string,
  token: string,
  namedRangeId: string
): Promise<{ endIndex: number } | null> {
  try {
    const res = await fetch(`${DOCS_API}/${docId}?fields=namedRanges`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const doc = await res.json()
    const groups = Object.values(doc.namedRanges ?? {}) as Array<{
      namedRanges?: Array<{ namedRangeId: string; ranges?: Array<{ endIndex: number }> }>
    }>
    for (const group of groups) {
      for (const nr of group.namedRanges ?? []) {
        if (nr.namedRangeId !== namedRangeId) continue
        const ranges = nr.ranges ?? []
        const last = ranges[ranges.length - 1]
        return last ? { endIndex: last.endIndex } : null
      }
    }
    return null  // range not found — e.g. the user deleted that part of the doc
  } catch {
    return null
  }
}

// Best-effort follow-up write: once a Wayback snapshot exists for a page, drop
// a small "· archived" hyperlink right after that page's caption. Runs well
// after the original save, so it needs its own (silent, non-interactive) token.
async function appendArchiveLinkToDoc(destinationId: string, namedRangeId: string, snapshotUrl: string) {
  try {
    const token = await getAuthTokenSilent()
    if (!token) return
    const pos = await resolveNamedRange(destinationId, token, namedRangeId)
    if (!pos) return

    const insertText = ' · archived'
    const sepEnd = pos.endIndex + ' · '.length
    const linkEnd = pos.endIndex + insertText.length

    const requests = [
      { insertText: { location: { index: pos.endIndex }, text: insertText } },
      {
        updateTextStyle: {
          range: { startIndex: pos.endIndex, endIndex: sepEnd },
          textStyle: { fontSize: { magnitude: 9, unit: 'PT' }, foregroundColor: { color: { rgbColor: CAPTION_FG } } },
          fields: 'fontSize,foregroundColor',
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: sepEnd, endIndex: linkEnd },
          textStyle: {
            link: { url: snapshotUrl },
            fontSize: { magnitude: 9, unit: 'PT' },
            foregroundColor: { color: { rgbColor: LINK_FG } },
            underline: false,
          },
          fields: 'link,fontSize,foregroundColor,underline',
        },
      },
    ]

    await fetch(`${DOCS_API}/${destinationId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
  } catch {
    // best-effort — a failed follow-up write just means no archive link this time
  }
}

async function saveCaptionBookmark(url: string, destinationId: string, namedRangeId: string) {
  const result = await chrome.storage.local.get(['docCaptionBookmarks'])
  const map = (result.docCaptionBookmarks as Record<string, Record<string, string>>) ?? {}
  map[url] = { ...(map[url] ?? {}), [destinationId]: namedRangeId }
  await chrome.storage.local.set({ docCaptionBookmarks: map })
}

// ── History ───────────────────────────────────────────────────────────────────

// The full clip archive (not the old recent-10 cap). Seeds itself from the legacy
// `history` store the first time, then grows to a bounded max so we stay well
// under chrome.storage.local's 10MB quota without needing unlimitedStorage.
const ARCHIVE_MAX = 1000

async function addToArchive(entry: HistoryEntry) {
  const result = await chrome.storage.local.get(['clips', 'history'])
  const clips = (result.clips as HistoryEntry[] | undefined) ?? (result.history as HistoryEntry[]) ?? []
  clips.unshift(entry)
  if (clips.length > ARCHIVE_MAX) clips.length = ARCHIVE_MAX
  await chrome.storage.local.set({ clips })
}

// ── Per-destination stats ───────────────────────────────────────────────────
// Persistent clip count + last-saved time, shown on each doc card. Kept in
// storage.local (not sync) to avoid sync write-quota churn on every clip.

async function bumpDocStats(destId: string) {
  const result = await chrome.storage.local.get(['docStats'])
  const stats = (result.docStats as DocStats) ?? {}
  const prev = stats[destId]?.count ?? 0
  stats[destId] = { count: prev + 1, lastSavedAt: Date.now() }
  await chrome.storage.local.set({ docStats: stats })
}

// ── Google Docs ───────────────────────────────────────────────────────────────

// Style requests for a margin note paragraph: italic + muted violet ("your voice",
// distinct from the verbatim quote) + left indent so it reads as a sub-line.
// Range excludes the trailing newline. No bullet — the note is a plain indented line.
function noteStyleRequests(startIndex: number, endIndex: number): object[] {
  return [
    {
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: {
          italic: true,
          foregroundColor: { color: { rgbColor: NOTE_FG } },
          fontSize: { magnitude: 10.5, unit: 'PT' },
        },
        fields: 'italic,foregroundColor,fontSize',
      },
    },
    {
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: {
          indentStart: { magnitude: NOTE_INDENT_PT, unit: 'PT' },
          spaceAbove: { magnitude: 0, unit: 'PT' },
          spaceBelow: { magnitude: BULLET_BELOW_PT, unit: 'PT' },
        },
        fields: 'indentStart,spaceAbove,spaceBelow',
      },
    },
  ]
}

// Make substrings of a clip clickable — each link range is offset by the clip's
// start index in the doc, then given the link, link colour, and an underline.
function linkStyleRequests(clipStart: number, links: LinkSpan[]): object[] {
  return links.map(link => ({
    updateTextStyle: {
      range: { startIndex: clipStart + link.start, endIndex: clipStart + link.end },
      textStyle: {
        link: { url: link.url },
        foregroundColor: { color: { rgbColor: LINK_FG } },
        underline: true,
      },
      fields: 'link,foregroundColor,underline',
    },
  }))
}

// Reply index of each createNamedRange request we push, so we can pull the
// resulting namedRangeId back out of the (parallel) batchUpdate replies array
// once it resolves. -1 means "we didn't ask for one in this save."
interface BookmarkIdx { caption: number; clipBlock: number }

async function appendToGoogleDoc(
  docId: string,
  token: string,
  text: string,
  pageTitle: string,
  pageUrl: string,
  isNewArticle: boolean,
  note: string,
  links: LinkSpan[]
): Promise<{ clipNamedRangeId: string | null; captionNamedRangeId: string | null }> {
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
  // No lead-in gap when this is the very first content in an otherwise empty doc.
  const isFirstBlock = insertionPoint <= 1
  const requests: object[] = []
  const bookmarkIdx: BookmarkIdx = { caption: -1, clipBlock: -1 }

  if (isNewArticle) {
    // New article → one heading, one caption (domain · date), then the first clip.
    // Structure:  HEADING_2 title  /  small grey "domain · date" (domain linked)  /  • clip
    const domain = new URL(pageUrl).hostname.replace(/^www\./, '')
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    const headingLine = `${pageTitle}\n`
    const captionLine = `${domain} · ${dateStr}\n`
    const clipLine    = `${text}\n`
    const noteLine    = note ? `↳ ${note}\n` : ''
    const insertText  = `${headingLine}${captionLine}${clipLine}${noteLine}`

    const headingStart = insertionPoint
    const headingEnd   = headingStart + headingLine.length
    const captionStart = headingEnd
    const domainEnd    = captionStart + domain.length
    const captionEnd   = captionStart + captionLine.length      // includes trailing \n
    const clipStart    = captionEnd
    const clipEnd      = clipStart + text.length + 1             // include \n for the bullet range
    const noteStart    = clipEnd                                // note paragraph begins right after the clip
    const noteEnd      = noteStart + noteLine.length            // includes trailing \n

    requests.push(
      { insertText: { endOfSegmentLocation: { segmentId: '' }, text: insertText } },
      // Title → Heading 2. Big space ABOVE separates blocks; tight space BELOW binds the caption.
      {
        updateParagraphStyle: {
          range: { startIndex: headingStart, endIndex: headingEnd },
          paragraphStyle: {
            namedStyleType: 'HEADING_2',
            spaceAbove: { magnitude: isFirstBlock ? 0 : BLOCK_GAP_PT, unit: 'PT' },
            spaceBelow: { magnitude: HEADING_BELOW_PT, unit: 'PT' },
          },
          fields: 'namedStyleType,spaceAbove,spaceBelow',
        },
      },
      // Caption "domain · date" → small + grey
      {
        updateTextStyle: {
          range: { startIndex: captionStart, endIndex: captionEnd - 1 },  // exclude trailing \n
          textStyle: {
            fontSize: { magnitude: 9, unit: 'PT' },
            foregroundColor: { color: { rgbColor: CAPTION_FG } },
            bold: false,
          },
          fields: 'fontSize,foregroundColor,bold',
        },
      },
      // Caption paragraph → hug the heading above, small air before the bullets below
      {
        updateParagraphStyle: {
          range: { startIndex: captionStart, endIndex: captionEnd - 1 },
          paragraphStyle: {
            spaceAbove: { magnitude: 0, unit: 'PT' },
            spaceBelow: { magnitude: CAPTION_BELOW_PT, unit: 'PT' },
          },
          fields: 'spaceAbove,spaceBelow',
        },
      },
      // Domain portion → hyperlink + link colour (overrides the grey above)
      {
        updateTextStyle: {
          range: { startIndex: captionStart, endIndex: domainEnd },
          textStyle: {
            link: { url: pageUrl },
            foregroundColor: { color: { rgbColor: LINK_FG } },
            underline: false,
          },
          fields: 'link,foregroundColor,underline',
        },
      },
      // First clip → bullet, snug spacing
      {
        createParagraphBullets: {
          range: { startIndex: clipStart, endIndex: clipEnd },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: clipStart, endIndex: clipEnd },
          paragraphStyle: {
            spaceAbove: { magnitude: 0, unit: 'PT' },
            spaceBelow: { magnitude: BULLET_BELOW_PT, unit: 'PT' },
          },
          fields: 'spaceAbove,spaceBelow',
        },
      }
    )
    // Preserve any hyperlinks inside the clip text
    if (links.length) requests.push(...linkStyleRequests(clipStart, links))
    // Margin note (if any) → indented italic sub-line under the first clip
    if (note) requests.push(...noteStyleRequests(noteStart, noteEnd - 1))

    // Bookmark the caption ("domain · date") so link-rot insurance can come back
    // later and drop an "· archived" link right after it, once a Wayback
    // snapshot exists — Docs keeps this position in sync as the doc is edited.
    bookmarkIdx.caption = requests.length
    requests.push({
      createNamedRange: { name: 'skcap', range: { startIndex: captionStart, endIndex: captionEnd - 1 } },
    })
    // Bookmark the whole clip block (bullet + its margin note, if any) so Living
    // Resurface can find this exact spot again and add a freshly dated note
    // AFTER whatever's already here, not in the middle of it.
    {
      const clipBlockEnd = note ? noteEnd - 1 : clipEnd - 1
      bookmarkIdx.clipBlock = requests.length
      requests.push({
        createNamedRange: { name: 'skclip', range: { startIndex: clipStart, endIndex: clipBlockEnd } },
      })
    }
  } else {
    // Same article as the last clip → just append another bullet, no heading
    const clipLine  = `${text}\n`
    const noteLine  = note ? `↳ ${note}\n` : ''
    const clipStart = insertionPoint
    const clipEnd   = clipStart + text.length + 1
    const noteStart = clipEnd
    const noteEnd   = noteStart + noteLine.length

    requests.push(
      { insertText: { endOfSegmentLocation: { segmentId: '' }, text: `${clipLine}${noteLine}` } },
      {
        createParagraphBullets: {
          range: { startIndex: clipStart, endIndex: clipEnd },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      },
      // Match the snug within-block bullet spacing
      {
        updateParagraphStyle: {
          range: { startIndex: clipStart, endIndex: clipEnd },
          paragraphStyle: {
            spaceAbove: { magnitude: 0, unit: 'PT' },
            spaceBelow: { magnitude: BULLET_BELOW_PT, unit: 'PT' },
          },
          fields: 'spaceAbove,spaceBelow',
        },
      }
    )
    // Preserve any hyperlinks inside the clip text
    if (links.length) requests.push(...linkStyleRequests(clipStart, links))
    // Margin note (if any) → indented italic sub-line under this clip
    if (note) requests.push(...noteStyleRequests(noteStart, noteEnd - 1))

    // Same clip-block bookmark as the new-article branch (see comment above).
    const clipBlockEnd = note ? noteEnd - 1 : clipEnd - 1
    bookmarkIdx.clipBlock = requests.length
    requests.push({
      createNamedRange: { name: 'skclip', range: { startIndex: clipStart, endIndex: clipBlockEnd } },
    })
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

  const batchJson = await batchRes.json()
  const replies: Array<{ createNamedRange?: { namedRangeId?: string } }> = batchJson.replies ?? []
  const clipNamedRangeId = bookmarkIdx.clipBlock >= 0
    ? replies[bookmarkIdx.clipBlock]?.createNamedRange?.namedRangeId ?? null
    : null
  const captionNamedRangeId = bookmarkIdx.caption >= 0
    ? replies[bookmarkIdx.caption]?.createNamedRange?.namedRangeId ?? null
    : null

  return { clipNamedRangeId, captionNamedRangeId }
}

// ── Notion ────────────────────────────────────────────────────────────────────

async function appendToNotion(
  token: string,
  pageId: string,
  text: string,
  pageTitle: string,
  pageUrl: string,
  isNewArticle: boolean,
  note: string
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

  if (note) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `↳ ${note}` },
            annotations: { italic: true, color: 'purple' },
          },
        ],
      },
    })
  }

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

// ── Images ────────────────────────────────────────────────────────────────────

// Scale an image (natural px) to fit the page width, preserving aspect ratio.
// Returns a Docs objectSize, or null when dimensions are unknown (let Docs decide).
function fitImageSize(w?: number, h?: number): object | null {
  if (!w || !h || w <= 0 || h <= 0) return null
  const PX_TO_PT = 0.75   // 72dpi / 96dpi
  const MAX_W_PT = 468    // letter width minus 1" margins each side
  let widthPt = w * PX_TO_PT
  let heightPt = h * PX_TO_PT
  if (widthPt > MAX_W_PT) {
    const scale = MAX_W_PT / widthPt
    widthPt *= scale
    heightPt *= scale
  }
  return {
    width: { magnitude: widthPt, unit: 'PT' },
    height: { magnitude: heightPt, unit: 'PT' },
  }
}

async function appendImageToGoogleDoc(
  docId: string,
  token: string,
  imageUrl: string,
  imgWidth: number | undefined,
  imgHeight: number | undefined,
  pageTitle: string,
  pageUrl: string,
  isNewArticle: boolean
): Promise<{ captionNamedRangeId: string | null }> {
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
  const isFirstBlock = insertionPoint <= 1
  const requests: object[] = []
  let imageIndex: number
  let captionRangeIdx = -1

  if (isNewArticle) {
    // Same heading + caption block as a text clip, then the image below it.
    const domain = new URL(pageUrl).hostname.replace(/^www\./, '')
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const headingLine = `${pageTitle}\n`
    const captionLine = `${domain} · ${dateStr}\n`
    const insertText  = `${headingLine}${captionLine}`

    const headingStart = insertionPoint
    const headingEnd   = headingStart + headingLine.length
    const captionStart = headingEnd
    const domainEnd    = captionStart + domain.length
    const captionEnd   = captionStart + captionLine.length

    requests.push(
      { insertText: { endOfSegmentLocation: { segmentId: '' }, text: insertText } },
      {
        updateParagraphStyle: {
          range: { startIndex: headingStart, endIndex: headingEnd },
          paragraphStyle: {
            namedStyleType: 'HEADING_2',
            spaceAbove: { magnitude: isFirstBlock ? 0 : BLOCK_GAP_PT, unit: 'PT' },
            spaceBelow: { magnitude: HEADING_BELOW_PT, unit: 'PT' },
          },
          fields: 'namedStyleType,spaceAbove,spaceBelow',
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: captionStart, endIndex: captionEnd - 1 },
          textStyle: {
            fontSize: { magnitude: 9, unit: 'PT' },
            foregroundColor: { color: { rgbColor: CAPTION_FG } },
            bold: false,
          },
          fields: 'fontSize,foregroundColor,bold',
        },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: captionStart, endIndex: captionEnd - 1 },
          paragraphStyle: {
            spaceAbove: { magnitude: 0, unit: 'PT' },
            spaceBelow: { magnitude: CAPTION_BELOW_PT, unit: 'PT' },
          },
          fields: 'spaceAbove,spaceBelow',
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: captionStart, endIndex: domainEnd },
          textStyle: {
            link: { url: pageUrl },
            foregroundColor: { color: { rgbColor: LINK_FG } },
            underline: false,
          },
          fields: 'link,foregroundColor,underline',
        },
      },
    )
    // Bookmark the caption, same as the text-clip path — link-rot insurance
    // uses this to drop an "· archived" link here once a snapshot exists.
    captionRangeIdx = requests.length
    requests.push({
      createNamedRange: { name: 'skcap', range: { startIndex: captionStart, endIndex: captionEnd - 1 } },
    })
    imageIndex = captionEnd  // the empty paragraph created after the caption's \n
  } else {
    // Continuation → drop the image on a fresh line at the end of the doc.
    requests.push({ insertText: { endOfSegmentLocation: { segmentId: '' }, text: '\n' } })
    imageIndex = insertionPoint + 1
  }

  const inlineImage: { location: { index: number }; uri: string; objectSize?: object } = {
    location: { index: imageIndex },
    uri: imageUrl,
  }
  const size = fitImageSize(imgWidth, imgHeight)
  if (size) inlineImage.objectSize = size
  requests.push({ insertInlineImage: inlineImage })

  const batchRes = await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!batchRes.ok) {
    const body = await batchRes.text()
    throw new Error(`Docs API batchUpdate ${batchRes.status}: ${body}`)
  }

  const batchJson = await batchRes.json()
  const replies: Array<{ createNamedRange?: { namedRangeId?: string } }> = batchJson.replies ?? []
  const captionNamedRangeId = captionRangeIdx >= 0
    ? replies[captionRangeIdx]?.createNamedRange?.namedRangeId ?? null
    : null

  return { captionNamedRangeId }
}

async function appendImageToNotion(
  token: string,
  pageId: string,
  imageUrl: string,
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
          { type: 'text', text: { content: ' [source]', link: { url: pageUrl } }, annotations: { color: 'blue' } },
        ],
      },
    })
  }

  children.push({
    object: 'block',
    type: 'image',
    image: { type: 'external', external: { url: imageUrl } },
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
  const { text, url, title, destinationId, destinationType, note, links } = payload
  const trimmedNote = note?.trim() ?? ''
  const linkSpans = links ?? []

  const storage = await chrome.storage.sync.get(['docs', 'docId', 'notionConfig'])

  // Migrate legacy single-doc storage to the docs array format
  let docs: DocDestination[] = storage.docs ?? []
  if (docs.length === 0 && storage.docId) {
    docs = [{ id: storage.docId as string, name: 'My Notes', active: true }]
  }

  const isNewArticle = (await getLastSavedUrl(destinationId)) !== url
  let destinationName = 'Notes'
  let clipNamedRangeId: string | null = null
  let captionNamedRangeId: string | null = null

  if (destinationType === 'gdoc') {
    const doc = docs.find(d => d.id === destinationId)
    if (!doc) throw new Error('Document not found. Check your SnipKeep settings.')
    destinationName = doc.name

    const token = await getAuthToken()
    const result = await withRetry(() =>
      appendToGoogleDoc(doc.id, token, text, title, url, isNewArticle, trimmedNote, linkSpans)
    )
    clipNamedRangeId = result.clipNamedRangeId
    captionNamedRangeId = result.captionNamedRangeId
  } else {
    const notionConfig = storage.notionConfig as NotionConfig | undefined
    if (!notionConfig?.token) throw new Error('Notion not configured. Open SnipKeep settings.')
    destinationName = notionConfig.pageName ?? 'Notion'

    await withRetry(() =>
      appendToNotion(notionConfig.token, notionConfig.pageId, text, title, url, isNewArticle, trimmedNote)
    )
  }

  await setLastSavedUrl(destinationId, url)

  // Remember where this page's caption lives so link-rot insurance can come
  // back later (once a Wayback snapshot exists) and drop an archive link there.
  if (isNewArticle && captionNamedRangeId) {
    await saveCaptionBookmark(url, destinationId, captionNamedRangeId)
  }

  // Best-effort link-rot insurance — fire-and-forget, never blocks the save or
  // its toast. Skips pages already snapshotted; silent on any failure.
  ensureArchived(url).catch(() => {})

  await addToArchive({
    text: text.slice(0, 1000),
    sourceTitle: title,
    sourceUrl: url,
    destinationName,
    destinationId,
    savedAt: Date.now(),
    ...(trimmedNote ? { note: trimmedNote.slice(0, 200) } : {}),
    // Bookmark for Living Resurface — lets it find this exact clip again later
    // and add a freshly dated note right after it, even as the doc grows.
    ...(clipNamedRangeId ? { namedRangeId: clipNamedRangeId } : {}),
  })

  await bumpDocStats(destinationId)
}

async function handleSaveImage(payload: SaveImageMessage['payload']) {
  const { imageUrl, width, height, url, title, destinationId, destinationType } = payload

  // Docs/Notion fetch the image server-side, so it must be a public web URL.
  if (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 2000) {
    throw new Error("This image can't be saved — it isn't a public web URL.")
  }

  const storage = await chrome.storage.sync.get(['docs', 'docId', 'notionConfig'])
  let docs: DocDestination[] = storage.docs ?? []
  if (docs.length === 0 && storage.docId) {
    docs = [{ id: storage.docId as string, name: 'My Notes', active: true }]
  }

  const isNewArticle = (await getLastSavedUrl(destinationId)) !== url
  let destinationName = 'Notes'
  let captionNamedRangeId: string | null = null

  if (destinationType === 'gdoc') {
    const doc = docs.find(d => d.id === destinationId)
    if (!doc) throw new Error('Document not found. Check your SnipKeep settings.')
    destinationName = doc.name

    const token = await getAuthToken()
    const result = await withRetry(() =>
      appendImageToGoogleDoc(doc.id, token, imageUrl, width, height, title, url, isNewArticle)
    )
    captionNamedRangeId = result.captionNamedRangeId
  } else {
    const notionConfig = storage.notionConfig as NotionConfig | undefined
    if (!notionConfig?.token) throw new Error('Notion not configured. Open SnipKeep settings.')
    destinationName = notionConfig.pageName ?? 'Notion'

    await withRetry(() =>
      appendImageToNotion(notionConfig.token, notionConfig.pageId, imageUrl, title, url, isNewArticle)
    )
  }

  await setLastSavedUrl(destinationId, url)

  if (isNewArticle && captionNamedRangeId) {
    await saveCaptionBookmark(url, destinationId, captionNamedRangeId)
  }

  ensureArchived(url).catch(() => {})
  await addToArchive({
    text: '🖼 Image',
    sourceTitle: title,
    sourceUrl: url,
    destinationName,
    destinationId,
    kind: 'image',
    savedAt: Date.now(),
  })
  await bumpDocStats(destinationId)
}

// Write a freshly dated note back into the Doc, right after a clip's bookmarked
// block — the exact spot the thought first appeared. Works for any bookmarked
// clip (not just a Resurfaced one), then reflects it in the local archive too,
// so the History card shows it without waiting for the drawer to reopen.
// Unlike the link-rot follow-up write, this is a direct user action, so an
// interactive token (and a real error on failure) is correct here — not a
// silent best-effort attempt.
async function handleAddDocNote(payload: AddDocNoteMessage['payload']) {
  const { destinationId, namedRangeId, note, entrySavedAt } = payload
  const trimmed = note.trim()
  if (!trimmed) throw new Error('Note is empty.')

  const token = await getAuthToken()
  const pos = await resolveNamedRange(destinationId, token, namedRangeId)
  if (!pos) throw new Error("Couldn't find that clip in the Doc anymore — it may have been edited or deleted.")

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const datedNote = `(${dateStr}) ${trimmed}`
  const noteLine = `↳ ${datedNote}\n`
  const insertStart = pos.endIndex
  const insertEnd = insertStart + noteLine.length

  const requests = [
    { insertText: { location: { index: insertStart }, text: noteLine } },
    ...noteStyleRequests(insertStart, insertEnd - 1),
  ]

  const batchRes = await fetch(`${DOCS_API}/${destinationId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!batchRes.ok) {
    const body = await batchRes.text()
    throw new Error(`Docs API batchUpdate ${batchRes.status}: ${body}`)
  }

  const result = await chrome.storage.local.get(['clips'])
  const clips = (result.clips as HistoryEntry[]) ?? []
  const idx = clips.findIndex(c => c.savedAt === entrySavedAt)
  if (idx !== -1) {
    const existing = clips[idx].note
    clips[idx] = { ...clips[idx], note: existing ? `${existing}\n${datedNote}` : datedNote }
    await chrome.storage.local.set({ clips })
  }
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
        console.error('[SnipKeep]', error)
        sendResponse({ success: false, error })
      }
    })()

    return true
  }
)

// Image save — initiated from the right-click context menu (via the content script).
chrome.runtime.onMessage.addListener(
  (message: SaveImageMessage, _sender, sendResponse: (r: SaveImageResponse) => void) => {
    if (message.type !== 'SAVE_IMAGE') return false

    ;(async () => {
      try {
        await handleSaveImage(message.payload)
        sendResponse({ success: true })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error('[SnipKeep]', error)
        sendResponse({ success: false, error })
      }
    })()

    return true
  }
)

// Add a dated note back into the Doc at a bookmarked clip (any clip, not just
// a Resurfaced one).
chrome.runtime.onMessage.addListener(
  (message: AddDocNoteMessage, _sender, sendResponse: (r: AddDocNoteResponse) => void) => {
    if (message.type !== 'ADD_DOC_NOTE') return false

    ;(async () => {
      try {
        await handleAddDocNote(message.payload)
        sendResponse({ success: true })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error('[SnipKeep]', error)
        sendResponse({ success: false, error })
      }
    })()

    return true
  }
)

// User email — fetched in the background where getProfileUserInfo is reliable
chrome.runtime.onMessage.addListener(
  (message: GetUserEmailMessage, _sender, sendResponse: (r: GetUserEmailResponse) => void) => {
    if (message.type !== 'GET_USER_EMAIL') return false

    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
      const email = info.email ?? ''
      if (email) chrome.storage.sync.set({ userEmail: email })
      sendResponse({ email })
    })

    return true
  }
)

// Sign-in — the gate screen runs in the content-script context where
// chrome.identity is undefined, so the interactive OAuth flow must run here.
chrome.runtime.onMessage.addListener(
  (message: SignInMessage, _sender, sendResponse: (r: SignInResponse) => void) => {
    if (message.type !== 'SIGN_IN') return false

    ;(async () => {
      try {
        await getAuthToken()  // interactive — surfaces the Google consent screen
        const email = await new Promise<string>((resolve) => {
          chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => resolve(info.email ?? ''))
        })
        await chrome.storage.sync.set({ isSignedIn: true, userEmail: email })
        sendResponse({ success: true, email })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Sign-in failed' })
      }
    })()

    return true
  }
)

// Sign-out — like sign-in, must run here: the drawer's content-script context has
// no chrome.identity. Drops Chrome's cached token and clears the app's auth flags.
chrome.runtime.onMessage.addListener(
  (message: SignOutMessage, _sender, sendResponse: (r: SignOutResponse) => void) => {
    if (message.type !== 'SIGN_OUT') return false

    ;(async () => {
      try {
        const token = await getAuthTokenSilent()
        if (token) {
          await new Promise<void>((resolve) =>
            chrome.identity.removeCachedAuthToken({ token }, () => resolve())
          )
        }
        await chrome.storage.sync.set({ isSignedIn: false, userEmail: '' })
        sendResponse({ success: true })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Sign-out failed' })
      }
    })()

    return true
  }
)

// Doc title lookup — content scripts (the drawer) can't call chrome.identity,
// so the title fetch must happen here.
chrome.runtime.onMessage.addListener(
  (message: GetDocTitleMessage, _sender, sendResponse: (r: GetDocTitleResponse) => void) => {
    if (message.type !== 'GET_DOC_TITLE') return false

    ;(async () => {
      try {
        const token = await getAuthTokenSilent()
        if (!token) { sendResponse({ title: null }); return }
        const res = await fetch(`${DOCS_API}/${message.docId}?fields=title`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { sendResponse({ title: null }); return }
        const data = await res.json() as { title?: string }
        sendResponse({ title: data.title ?? null })
      } catch {
        sendResponse({ title: null })
      }
    })()

    return true
  }
)

// Extension icon click → toggle the right-side drawer.
// Tabs that were already open before the extension loaded have no content script
// (manifest content_scripts only inject into pages loaded after install/reload).
// If the message has no receiver, inject the script on demand via activeTab, then retry.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  const tabId = tab.id
  const msg: ToggleDrawerMessage = { type: 'TOGGLE_DRAWER' }

  try {
    await chrome.tabs.sendMessage(tabId, msg)
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/index.js'],
      })
      await chrome.tabs.sendMessage(tabId, msg)
    } catch {
      // Restricted page (New Tab, chrome://, Web Store, PDF viewer) — Chrome blocks
      // all extensions here. Tell the user the problem and the fix.
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: "SnipKeep can't open here",
        message: 'Chrome blocks extensions on its built-in pages. Open SnipKeep on any website instead.',
      })
    }
  }
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

// ── Right-click "Save image to SnipKeep" ──────────────────────────────────────
const IMAGE_MENU_ID = 'snipkeep-save-image'

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first so a reload during development can't duplicate-id error.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: IMAGE_MENU_ID,
      title: 'Save image to SnipKeep',
      contexts: ['image'],
    })
  })
})

// The content script reads the image's dimensions + page title, then routes the
// save back through SAVE_IMAGE. Inject on demand for tabs opened pre-install.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== IMAGE_MENU_ID || !info.srcUrl || !tab?.id) return
  const tabId = tab.id
  const msg: CaptureImageMessage = { type: 'CAPTURE_IMAGE', srcUrl: info.srcUrl }

  try {
    await chrome.tabs.sendMessage(tabId, msg)
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/index.js'] })
      await chrome.tabs.sendMessage(tabId, msg)
    } catch {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: "SnipKeep can't save here",
        message: "Chrome blocks extensions on this page, so the image can't be captured.",
      })
    }
  }
})
