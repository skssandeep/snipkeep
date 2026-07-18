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
  GetUserProfileMessage,
  GetUserProfileResponse,
  GetDocTitleMessage,
  GetDocTitleResponse,
  SignInMessage,
  SignInResponse,
  SignOutMessage,
  SignOutResponse,
  AddDocNoteMessage,
  AddDocNoteResponse,
  StartVoiceNoteMessage,
  StartVoiceNoteResponse,
  StopVoiceNoteMessage,
  VoiceTabStopMessage,
  VoiceTabNeedsForegroundMessage,
  VoiceRecognitionEventMessage,
  VoiceNoteUpdateMessage,
  AIProvider,
  AIConfig,
  ConnectAIMessage,
  ConnectAIResponse,
  DisconnectAIMessage,
  DisconnectAIResponse,
  AskFollowUpMessage,
  AskFollowUpResponse,
  SummarizeTopicMessage,
  SummarizeTopicResponse,
  OpenStudyMessage,
  OpenStudyResponse,
  UpdateBibliographyMessage,
  UpdateBibliographyResponse,
} from '../types'
import { formatVideoTime, timedVideoUrl } from '../lib/video'

const DOCS_API = 'https://docs.googleapis.com/v1/documents'
const NOTION_API = 'https://api.notion.com/v1'
const LINK_FG    = { red: 0.20, green: 0.46, blue: 0.80 }  // domain hyperlink
const CAPTION_FG = { red: 0.50, green: 0.50, blue: 0.50 }  // grey source caption
const NOTE_FG    = { red: 0.443, green: 0.388, blue: 0.114 }  // dark marker-yellow ink — the reader's own voice (6.0:1 on the Doc's white page)
const NOTE_INDENT_PT = 18  // margin note sits indented under its clip

// Vertical rhythm (pt). Proximity: the between-block gap must dwarf every
// within-block gap, so each source reads as one tight unit.
const BLOCK_GAP_PT     = 30  // above a new article heading (separates blocks)
const HEADING_BELOW_PT = 3   // heading → caption (caption hugs its title)
const CAPTION_BELOW_PT = 14  // caption → first bullet (~one blank line)
const BULLET_BELOW_PT  = 2   // bullet → bullet (snug)

// ── Auth ─────────────────────────────────────────────────────────────────────

// Promise form on purpose: Chrome's CALLBACK form passes the token as a plain
// string (verified against the official docs), but @types/chrome mis-types the
// callback parameter as GetAuthTokenResult — the object only the promise form
// actually returns. Using the promise form is the one shape where the runtime
// and the types agree.
async function getAuthToken(): Promise<string> {
  const result = await chrome.identity.getAuthToken({ interactive: true })
  if (!result.token) throw new Error('Authentication failed: no token returned')
  return result.token
}

// Turn Chrome's terse identity errors into guidance the user can act on. The
// big one: with NO Google account signed into Chrome at all, getAuthToken
// rejects with "The user is not signed in." / "OAuth2 not granted or revoked."
// — which says nothing about the actual fix (add an account to the browser).
function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('not signed in') || m.includes('no accounts') || m.includes('not granted or revoked')) {
    return 'No Google account is signed into Chrome. Click your profile picture at the top-right of the browser, add your Google account, then try Connect with Google again.'
  }
  if (m.includes('did not approve') || m.includes('access') && m.includes('denied') || m.includes('canceled') || m.includes('cancelled')) {
    return 'Sign-in was cancelled. Click Connect with Google to try again.'
  }
  return raw
}

// Non-interactive — for background lookups that must never pop a sign-in prompt.
async function getAuthTokenSilent(): Promise<string | null> {
  try {
    const result = await chrome.identity.getAuthToken({ interactive: false })
    return result.token ?? null
  } catch {
    return null
  }
}

// Display name — chrome.identity.getProfileUserInfo only ever returns
// {email, id}, never a name, regardless of scopes; the only way to get one is
// Google's own userinfo endpoint, which requires the userinfo.profile scope.
// Best-effort and silent: a token issued before that scope was added (any
// already-signed-in user) won't carry it, and this simply returns null rather
// than erroring — the UI already treats a missing name as "not available yet,
// show email only," not a failure.
async function getUserName(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.name === 'string' && data.name ? data.name : null
  } catch {
    return null
  }
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
): Promise<{ startIndex: number; endIndex: number } | null> {
  try {
    const res = await fetch(`${DOCS_API}/${docId}?fields=namedRanges`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const doc = await res.json()
    const groups = Object.values(doc.namedRanges ?? {}) as Array<{
      namedRanges?: Array<{ namedRangeId: string; ranges?: Array<{ startIndex: number; endIndex: number }> }>
    }>
    for (const group of groups) {
      for (const nr of group.namedRanges ?? []) {
        if (nr.namedRangeId !== namedRangeId) continue
        const ranges = nr.ranges ?? []
        if (!ranges.length) return null
        // startIndex from the first sub-range, endIndex from the last — these
        // bookmarks are always created in one batchUpdate as a single
        // contiguous span, so in practice there's exactly one sub-range.
        return { startIndex: ranges[0].startIndex, endIndex: ranges[ranges.length - 1].endIndex }
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

// Style requests for a margin note paragraph: italic + muted gold-brown ("your voice",
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

// Lecture-timestamp clipping: a small caption-styled " · 43:21" suffix at the
// end of a video clip's bullet, deep-linking to the exact moment in the
// lecture. textLen..clipTextLen is the suffix's range inside the clip line.
function videoStampRequest(clipStart: number, textLen: number, clipTextLen: number, pageUrl: string, videoTime: number): object {
  return {
    updateTextStyle: {
      range: { startIndex: clipStart + textLen, endIndex: clipStart + clipTextLen },
      textStyle: {
        link: { url: timedVideoUrl(pageUrl, videoTime) },
        fontSize: { magnitude: 9, unit: 'PT' },
        foregroundColor: { color: { rgbColor: LINK_FG } },
        underline: false,
      },
      fields: 'link,fontSize,foregroundColor,underline',
    },
  }
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
  links: LinkSpan[],
  videoTime?: number
): Promise<{ clipNamedRangeId: string | null; captionNamedRangeId: string | null }> {
  // Lecture-timestamp clipping: the clip line carries a " · 43:21" suffix
  // linking to the exact video moment. LinkSpan offsets are relative to the
  // ORIGINAL text and the suffix sits after it, so they need no adjustment.
  const stamp = videoTime !== undefined ? ` · ${formatVideoTime(videoTime)}` : ''
  const clipText = `${text}${stamp}`
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
    const clipLine    = `${clipText}\n`
    const noteLine    = note ? `↳ ${note}\n` : ''
    const insertText  = `${headingLine}${captionLine}${clipLine}${noteLine}`

    const headingStart = insertionPoint
    const headingEnd   = headingStart + headingLine.length
    const captionStart = headingEnd
    const domainEnd    = captionStart + domain.length
    const captionEnd   = captionStart + captionLine.length      // includes trailing \n
    const clipStart    = captionEnd
    const clipEnd      = clipStart + clipText.length + 1         // include \n for the bullet range
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
    // Lecture-timestamp suffix → small link back to the exact video moment
    if (stamp) requests.push(videoStampRequest(clipStart, text.length, clipText.length, pageUrl, videoTime!))
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
    const clipLine  = `${clipText}\n`
    const noteLine  = note ? `↳ ${note}\n` : ''
    const clipStart = insertionPoint
    const clipEnd   = clipStart + clipText.length + 1
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
    // Lecture-timestamp suffix → small link back to the exact video moment
    if (stamp) requests.push(videoStampRequest(clipStart, text.length, clipText.length, pageUrl, videoTime!))
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

// ── Works Cited (docs/IDEAS.md #2) ──────────────────────────────────────────
// A single "Works Cited" block, kept at the true end of the Doc, rebuilt
// fresh from the complete citation list every time one is added — NOT
// appended to incrementally. Rebuilding is simpler and more robust than
// tracking per-entry insertion points: it's the only way to keep the whole
// block both deduplicated/alphabetized (order can change as new sources are
// added) AND actually at the bottom (any existing copy is deleted first, the
// new one is inserted at the doc's current end, same as a fresh clip).
//
// Known limitation: this only repositions the block at the moment a citation
// is added. Saving further clips afterward without citing anything new won't
// move it again — it stays wherever it last landed until the next Cite
// action pulls it back to the true bottom. Documented, not silently assumed.

async function updateBibliography(destinationId: string, citations: string[]): Promise<void> {
  const token = await getAuthToken()

  const bookmarks = await chrome.storage.local.get(['worksCitedBookmarks'])
  const map = (bookmarks.worksCitedBookmarks as Record<string, string>) ?? {}
  const existingId = map[destinationId]

  // Always remove any existing block first — rebuilding at the end without
  // deleting the old copy would leave a stale, now-out-of-place duplicate
  // sitting wherever it used to be.
  if (existingId) {
    const pos = await resolveNamedRange(destinationId, token, existingId)
    if (pos) {
      await fetch(`${DOCS_API}/${destinationId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ deleteContentRange: { range: { startIndex: pos.startIndex, endIndex: pos.endIndex } } }],
        }),
      })
    }
  }

  if (citations.length === 0) {
    // Cite only ever adds, never removes, so this shouldn't normally happen —
    // stay consistent if it ever does rather than leaving a stale bookmark.
    delete map[destinationId]
    await chrome.storage.local.set({ worksCitedBookmarks: map })
    return
  }

  // Re-fetch the doc's current end (post-deletion) and append the fresh
  // block there — same endOfSegmentLocation pattern as a new clip.
  const docRes = await fetch(`${DOCS_API}/${destinationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!docRes.ok) throw new Error(`Docs API GET ${docRes.status}: ${await docRes.text()}`)
  const doc = await docRes.json()
  const bodyContent = doc.body.content
  const endIndex: number = bodyContent[bodyContent.length - 1].endIndex
  const insertionPoint = endIndex - 1
  const isFirstBlock = insertionPoint <= 1

  const headingLine = 'Works Cited\n'
  // Blank line between entries reads as a hanging bibliography list. A
  // multi-line citation (BibTeX) breaks into several real paragraphs here —
  // a known, accepted quirk of that one style, not specially handled.
  const listBody = citations.join('\n\n') + '\n'
  const insertText = `${headingLine}${listBody}`

  const headingStart = insertionPoint
  const headingEnd = headingStart + headingLine.length
  const listStart = headingEnd
  const listEnd = listStart + listBody.length

  const requests: object[] = [
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
        range: { startIndex: listStart, endIndex: listEnd - 1 },
        textStyle: { fontSize: { magnitude: 10, unit: 'PT' } },
        fields: 'fontSize',
      },
    },
  ]

  const bookmarkIdx = requests.length
  requests.push({
    createNamedRange: { name: 'skworkscited', range: { startIndex: headingStart, endIndex: listEnd - 1 } },
  })

  const batchRes = await fetch(`${DOCS_API}/${destinationId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!batchRes.ok) throw new Error(`Docs API batchUpdate ${batchRes.status}: ${await batchRes.text()}`)

  const batchJson = await batchRes.json()
  const replies: Array<{ createNamedRange?: { namedRangeId?: string } }> = batchJson.replies ?? []
  const newId = replies[bookmarkIdx]?.createNamedRange?.namedRangeId
  if (newId) {
    map[destinationId] = newId
    await chrome.storage.local.set({ worksCitedBookmarks: map })
  }
}

chrome.runtime.onMessage.addListener(
  (message: UpdateBibliographyMessage, _sender, sendResponse: (r: UpdateBibliographyResponse) => void) => {
    if (message.type !== 'UPDATE_BIBLIOGRAPHY') return false

    ;(async () => {
      try {
        await updateBibliography(message.payload.destinationId, message.payload.citations)
        sendResponse({ success: true })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Bibliography update failed' })
      }
    })()

    return true
  }
)

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
  const { text, url, title, destinationId, destinationType, note, links, videoTime } = payload
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
      appendToGoogleDoc(doc.id, token, text, title, url, isNewArticle, trimmedNote, linkSpans, videoTime)
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

  // Hoisted so the fire-and-forget question draft below can find this exact
  // entry again — savedAt is the archive's de-facto primary key.
  const savedAt = Date.now()

  await addToArchive({
    text: text.slice(0, 1000),
    sourceTitle: title,
    sourceUrl: url,
    destinationName,
    destinationId,
    savedAt,
    ...(trimmedNote ? { note: trimmedNote.slice(0, 200) } : {}),
    // Bookmark for Living Resurface — lets it find this exact clip again later
    // and add a freshly dated note right after it, even as the doc grows.
    ...(clipNamedRangeId ? { namedRangeId: clipNamedRangeId } : {}),
    // Lecture-timestamp clipping — drives the History card's Source deep link.
    ...(videoTime !== undefined ? { videoTime } : {}),
  })

  // Retrieval Flip — fire-and-forget like ensureArchived above: a missing AI
  // key, rejected key, or API failure silently yields no question, and the
  // save's response never waits on this.
  draftRetrievalQuestion(text, savedAt).catch(() => {})

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

// User profile — fetched in the background where getProfileUserInfo is
// reliable. Email always works (Chrome-level API, no scope needed); name is
// best-effort via getUserName and silently null if the current token
// predates the userinfo.profile scope (an already-signed-in user — they'll
// pick up a name on their next sign-in, once that grants the new scope).
chrome.runtime.onMessage.addListener(
  (message: GetUserProfileMessage, _sender, sendResponse: (r: GetUserProfileResponse) => void) => {
    if (message.type !== 'GET_USER_PROFILE') return false

    ;(async () => {
      const email = await new Promise<string>((resolve) => {
        chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => resolve(info.email ?? ''))
      })
      const token = await getAuthTokenSilent()
      const name = token ? await getUserName(token) : null

      const toStore: Record<string, string> = {}
      if (email) toStore.userEmail = email
      if (name) toStore.userName = name
      if (Object.keys(toStore).length > 0) chrome.storage.sync.set(toStore)

      sendResponse({ email, name })
    })()

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
        const token = await getAuthToken()  // interactive — surfaces the Google consent screen
        const email = await new Promise<string>((resolve) => {
          chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => resolve(info.email ?? ''))
        })
        const name = await getUserName(token)
        await chrome.storage.sync.set({ isSignedIn: true, userEmail: email, ...(name ? { userName: name } : {}) })
        sendResponse({ success: true, email, name })
      } catch (err) {
        sendResponse({ success: false, error: friendlyAuthError(err instanceof Error ? err.message : 'Sign-in failed') })
      }
    })()

    return true
  }
)

// Sign-out — like sign-in, must run here: the drawer's content-script context has
// no chrome.identity. Revokes the Google-side grant, drops Chrome's cached
// token, and clears the app's auth flags.
//
// The revoke fetch is the part that makes account SWITCHING possible: an
// earlier version only removed the local cache, leaving the Google-side
// grant alive — so the next interactive getAuthToken silently re-minted a
// token for the same account with zero UI, and a user with multiple Chrome
// accounts could never reach the account chooser. With the grant revoked,
// the next sign-in starts from nothing and Chrome shows its sign-in dialog
// (including account selection when the profile has several).
chrome.runtime.onMessage.addListener(
  (message: SignOutMessage, _sender, sendResponse: (r: SignOutResponse) => void) => {
    if (message.type !== 'SIGN_OUT') return false

    ;(async () => {
      try {
        const token = await getAuthTokenSilent()
        if (token) {
          // Best-effort: offline shouldn't block local sign-out. no-cors on
          // purpose — accounts.google.com isn't in host_permissions, and the
          // revoke only needs the request to LAND, not a readable response.
          await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, { mode: 'no-cors' }).catch(() => {})
          await chrome.identity.clearAllCachedAuthTokens()
        }
        await chrome.storage.sync.set({ isSignedIn: false, userEmail: '', userName: '' })
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
  // frameId: 0 (the main frame) — content scripts now run in every frame
  // (all_frames: true, so the clip toolbar works inside iframes like Google
  // Drive's file-preview viewer), and chrome.tabs.sendMessage without an
  // explicit frameId broadcasts to ALL of them. The drawer must only ever
  // exist once, at the page level — never duplicated into an iframe.
  const opts = { frameId: 0 }

  try {
    await chrome.tabs.sendMessage(tabId, msg, opts)
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/index.js'],
      })
      await chrome.tabs.sendMessage(tabId, msg, opts)
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
  // The right-click happened in a specific frame (info.frameId — 0 for the
  // main frame, present since content scripts now run in every frame via
  // all_frames: true). Target that exact frame rather than broadcasting to
  // all of them, since only that frame actually has the clicked image.
  const frameId = info.frameId ?? 0

  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId })
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['src/content/index.js'] })
      await chrome.tabs.sendMessage(tabId, msg, { frameId })
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

// ── Voice-note capture ─────────────────────────────────────────────────────
// SpeechRecognition/getUserMedia run in a real, visible tab (src/voice/), not
// a chrome.offscreen document. Offscreen was tried first specifically to
// avoid a visible tab appearing — confirmed live that it doesn't work:
// getUserMedia there fails immediately with NotAllowedError and no prompt
// ever shown, and granting the permission via a separate real tab first
// didn't make a subsequent offscreen attempt succeed either. A real tab is
// the one thing proven to work end to end, so recognition happens right
// there instead. See CLAUDE.md's "Voice tab" section for the full design.

// In-memory only — a live-streaming interaction, not persisted data. If the
// service worker is killed mid-recording, that one session just stops.
let voiceSession: { originTabId: number; originFrameId: number; voiceTabId: number } | null = null

function endVoiceSession(returnFocus: boolean) {
  if (!voiceSession) return
  const { originTabId } = voiceSession
  voiceSession = null
  if (returnFocus) chrome.tabs.update(originTabId, { active: true }).catch(() => {})
}

chrome.runtime.onMessage.addListener(
  (message: StartVoiceNoteMessage, sender, sendResponse: (r: StartVoiceNoteResponse) => void) => {
    if (message.type !== 'START_VOICE_NOTE') return false

    ;(async () => {
      if (!sender.tab?.id) { sendResponse({ success: false, error: 'No active tab' }); return }
      try {
        // active: false — the user should stay on the page they're
        // clipping from and watch the note field fill in live, not have
        // their focus yanked to a separate tab. It brings itself forward
        // (VOICE_TAB_NEEDS_FOREGROUND, below) only the one time it actually
        // needs to: granting mic permission for the first time.
        const voiceTab = await chrome.tabs.create({ url: 'src/voice/index.html', openerTabId: sender.tab.id, active: false })
        if (!voiceTab.id) throw new Error('Could not open the voice-input tab')
        voiceSession = { originTabId: sender.tab.id, originFrameId: sender.frameId ?? 0, voiceTabId: voiceTab.id }
        sendResponse({ success: true })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Could not start voice input' })
      }
    })()

    return true
  }
)

chrome.runtime.onMessage.addListener((message: StopVoiceNoteMessage) => {
  if (message.type !== 'STOP_VOICE_NOTE') return false
  if (voiceSession) {
    const stop: VoiceTabStopMessage = { type: 'VOICE_TAB_STOP' }
    chrome.tabs.sendMessage(voiceSession.voiceTabId, stop).catch(() => {})
  }
  return false
})

// Relays the voice tab's transcript/error/ended events to the one tab+frame
// that actually asked for them — chrome.tabs.sendMessage with an explicit
// frameId, not a chrome.runtime broadcast, so this can't double-deliver to
// every open tab's content script.
chrome.runtime.onMessage.addListener((message: VoiceRecognitionEventMessage, sender) => {
  if (message.type !== 'VOICE_RECOGNITION_EVENT') return false
  // Only accept this from the specific voice tab this session opened — a
  // real tab now (not an offscreen doc), so it does have a sender.tab; the
  // check is that its id matches, not merely that a tab id is present.
  if (!voiceSession || sender.tab?.id !== voiceSession.voiceTabId) return false

  const { originTabId, originFrameId } = voiceSession
  const update: VoiceNoteUpdateMessage = { type: 'VOICE_NOTE_UPDATE', event: message.event }
  chrome.tabs.sendMessage(originTabId, update, { frameId: originFrameId }).catch(() => {})

  if (message.event.kind === 'ended' || message.event.kind === 'error') endVoiceSession(true)
  return false
})

// The voice tab asks for this the one time it actually needs the user's
// attention — granting mic permission for the first time (Chrome's native
// dialog needs a visible, active tab to appear on at all). Every other time
// (permission already granted), this never fires, and the tab stays quietly
// in the background the whole session.
chrome.runtime.onMessage.addListener((message: VoiceTabNeedsForegroundMessage, sender) => {
  if (message.type !== 'VOICE_TAB_NEEDS_FOREGROUND') return false
  if (sender.tab?.id) chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {})
  return false
})

// The voice tab can also close on its own (user closes it manually, or it
// self-closes after an error state) without the 'ended'/'error' event above
// necessarily having been the thing that triggered it — clean up either way
// so a stale session can't linger.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (voiceSession?.voiceTabId === tabId) endVoiceSession(true)
})

// ── Bring-your-own-AI-key (docs/IDEAS.md #3) ──
// Validated and stored here, not in the Popup/Drawer content-script context —
// same reason every other external API call (Google Docs, Notion) lives in
// the background: content-script fetches are subject to the host page's CSP.
// A cheap models-list GET confirms the key actually works before it's
// persisted, so a bad key fails immediately instead of silently on first use.

async function validateAIKey(provider: AIProvider, apiKey: string): Promise<void> {
  let res: Response
  if (provider === 'openai') {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } else if (provider === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/models', {
      // Anthropic blocks direct browser-origin requests by default (CORS) —
      // this header is the documented, explicit opt-in for exactly this
      // case: the user's own key, called straight from their own browser
      // extension, never proxied through a SnipKeep server (there isn't
      // one). Same flag the official SDK sets under `dangerouslyAllowBrowser`.
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
  } else {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`)
  }

  if (!res.ok) throw new Error(await aiErrorMessage(res))
}

chrome.runtime.onMessage.addListener(
  (message: ConnectAIMessage, _sender, sendResponse: (r: ConnectAIResponse) => void) => {
    if (message.type !== 'CONNECT_AI') return false

    ;(async () => {
      try {
        const { provider, apiKey } = message.payload
        await validateAIKey(provider, apiKey)
        const config: AIConfig = { provider, apiKey }
        await chrome.storage.local.set({ aiConfig: config })
        sendResponse({ success: true })
        // A key just became available — clips saved before it existed can get
        // their retrieval questions now.
        runRetrievalBackfill().catch(() => {})
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Connection failed' })
      }
    })()

    return true
  }
)

chrome.runtime.onMessage.addListener(
  (message: DisconnectAIMessage, _sender, sendResponse: (r: DisconnectAIResponse) => void) => {
    if (message.type !== 'DISCONNECT_AI') return false

    ;(async () => {
      await chrome.storage.local.remove('aiConfig')
      sendResponse({ success: true })
    })()

    return true
  }
)

// ── AI actions (docs/IDEAS.md #3, connection UX + first two actions) ──
// Both actions below share one adapter across the three providers. Fast/cheap
// models on purpose — this is a small utility call (a few sentences), not a
// heavy reasoning task. 'gemini-flash-latest' is a durable alias Google keeps
// pointed at its current fast model, chosen over a dated snapshot id
// specifically so this doesn't silently break when Google retires one.
const OPENAI_MODEL = 'gpt-5-nano'
const ANTHROPIC_MODEL = 'claude-haiku-4-5'
const GEMINI_MODEL = 'gemini-flash-latest'

// Reads the provider's own error body rather than guessing from the status
// code alone — a 401/403 covers several distinct causes (bad key, revoked
// key, no billing set up, model access not granted on this account) that all
// need a different fix, and a generic "rejected" message hides which one it
// actually is. All three providers shape their error body the same way
// (`{ error: { message: "..." } }`), so one read path covers all of them.
async function aiErrorMessage(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json()
    detail = (body?.error?.message as string | undefined) ?? ''
  } catch {
    // Non-JSON error body — fall through to the generic message below.
  }
  if (res.status === 401 || res.status === 403) {
    return detail || 'Your AI key was rejected — reconnect it from the ✨ AI screen.'
  }
  if (res.status === 429) {
    return detail || 'Rate limited by your AI provider — try again in a moment.'
  }
  return detail || `AI request failed (status ${res.status}).`
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const storage = await chrome.storage.local.get(['aiConfig'])
  const config = storage.aiConfig as AIConfig | undefined
  if (!config?.apiKey) throw new Error('Connect an AI provider first — open the ✨ AI screen.')

  if (config.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) throw new Error(await aiErrorMessage(res))
    const data = await res.json()
    return (data.choices?.[0]?.message?.content as string | undefined) ?? ''
  }

  if (config.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) throw new Error(await aiErrorMessage(res))
    const data = await res.json()
    return (data.content?.[0]?.text as string | undefined) ?? ''
  }

  // gemini
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
      }),
    }
  )
  if (!res.ok) throw new Error(await aiErrorMessage(res))
  const data = await res.json()
  return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined) ?? ''
}

// Explicitly asks for exactly 3 questions, not a written reflection — the
// point (see docs/IDEAS.md #3) is the student does the thinking; the model
// only points at where to look, never writes the answer for them.
// Retrieval Flip: draft ONE question this clip answers, then patch it onto the
// already-saved archive entry. Called fire-and-forget from handleSave — every
// failure path (no key, API error, empty/oversized reply) just leaves the
// entry question-less, which the History card renders exactly as before.
async function draftRetrievalQuestion(text: string, savedAt: number) {
  if (text.trim().length < 40) return  // too short to make a non-trivial question

  const system =
    'You write one retrieval-practice question for a student. Given a saved clip of text, write ' +
    'exactly ONE short question (under 120 characters) that the clip itself answers. The question ' +
    'must be answerable from the clip alone, must not contain the answer, and must not be a ' +
    'yes/no question. Reply with only the question.'
  const raw = await callAI(system, text.slice(0, 1000))
  const question = raw
    .split('\n')
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)[0]
  if (!question || question.length > 200) return

  // Fresh re-read before writing back — the AI call was in flight, and other
  // saves may have changed `clips` since (same pattern as handleAddDocNote).
  const result = await chrome.storage.local.get(['clips'])
  const clips = (result.clips as HistoryEntry[]) ?? []
  const idx = clips.findIndex(c => c.savedAt === savedAt)
  if (idx === -1) return  // entry deleted (or aged past ARCHIVE_MAX) meanwhile
  clips[idx] = { ...clips[idx], retrievalQuestion: question }
  await chrome.storage.local.set({ clips })
}

// One-time backfill: clips saved before Retrieval Flip shipped have no
// questions, which left the study picker looking empty next to a rich
// archive. Sequential (no API burst), idempotent (skips clips that already
// have questions), and resumable: the done-flag is only set after a pass
// with at least one success — so a dead key (every call failing) doesn't
// burn the one-time semantics, and a service worker killed mid-pass just
// resumes the remainder on next startup. Per-clip failures are attempted
// once and then skipped for good.
let backfillRunning = false
async function runRetrievalBackfill() {
  if (backfillRunning) return
  backfillRunning = true
  try {
    const stored = await chrome.storage.local.get(['aiConfig', 'retrievalBackfillDone', 'clips'])
    if (stored.retrievalBackfillDone || !stored.aiConfig) return
    const list = (stored.clips as HistoryEntry[]) ?? []
    const remaining = list.filter(
      c => !c.retrievalQuestion && c.kind !== 'image' && c.text.trim().length >= 40
    )
    if (remaining.length === 0) {
      await chrome.storage.local.set({ retrievalBackfillDone: true })
      return
    }
    let successes = 0
    for (const clip of remaining) {
      try {
        await draftRetrievalQuestion(clip.text, clip.savedAt)
        successes++
      } catch {
        // this clip's draft failed — move on, don't abort the pass
      }
    }
    if (successes > 0) await chrome.storage.local.set({ retrievalBackfillDone: true })
  } finally {
    backfillRunning = false
  }
}
runRetrievalBackfill().catch(() => {})

async function handleAskFollowUp(text: string): Promise<string[]> {
  const system =
    'You help a student think more deeply about something they just saved while researching. ' +
    'Given a short clip of saved text, write exactly 3 short, specific follow-up questions that ' +
    'would deepen their understanding of it. Reply with ONLY the 3 questions, one per line, no ' +
    'numbering, no preamble, no closing remarks.'
  const raw = await callAI(system, text)
  return raw
    .split('\n')
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

async function handleSummarizeTopic(destinationName: string, clips: string[]): Promise<string> {
  const system =
    'Summarize a student\'s saved research clips on one topic into a short, coherent overview ' +
    '(3-5 sentences). Be concrete — reference what was actually saved, don\'t just say "notes were ' +
    'saved about X."'
  const body = clips.map((c, i) => `${i + 1}. ${c}`).join('\n')
  const user = `Topic: ${destinationName}\n\nSaved clips:\n${body}`
  return callAI(system, user)
}

chrome.runtime.onMessage.addListener(
  (message: AskFollowUpMessage, _sender, sendResponse: (r: AskFollowUpResponse) => void) => {
    if (message.type !== 'ASK_FOLLOWUP') return false

    ;(async () => {
      try {
        const questions = await handleAskFollowUp(message.payload.text)
        sendResponse({ success: true, questions })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Request failed' })
      }
    })()

    return true
  }
)

chrome.runtime.onMessage.addListener(
  (message: SummarizeTopicMessage, _sender, sendResponse: (r: SummarizeTopicResponse) => void) => {
    if (message.type !== 'SUMMARIZE_TOPIC') return false

    ;(async () => {
      try {
        const summary = await handleSummarizeTopic(message.payload.destinationName, message.payload.clips)
        sendResponse({ success: true, summary })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Request failed' })
      }
    })()

    return true
  }
)

// Retrieval Flip's study surface — a full-page extension tab (same bundling
// pattern as the voice tab: not in the manifest, listed in vite.config's
// additionalInputs). Opened here because content-script contexts can't
// navigate to chrome-extension:// URLs themselves.
chrome.runtime.onMessage.addListener(
  (message: OpenStudyMessage, _sender, sendResponse: (r: OpenStudyResponse) => void) => {
    if (message.type !== 'OPEN_STUDY') return false

    ;(async () => {
      try {
        const dest = message.payload.destinationId
        const url = chrome.runtime.getURL(`src/study/index.html${dest ? `?doc=${encodeURIComponent(dest)}` : ''}`)
        await chrome.tabs.create({ url })
        sendResponse({ success: true })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : 'Could not open the study page' })
      }
    })()

    return true
  }
)
