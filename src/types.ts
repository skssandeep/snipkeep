export interface DocDestination {
  id: string
  name: string
  active: boolean  // false = stored but hidden from toolbar
  dueDate?: string // optional ISO date (YYYY-MM-DD) — Deadline-Aware Citations
  done?: boolean   // Assignment/Project Mode — finished, tucked into "Completed"
}

export interface NotionConfig {
  token: string
  pageId: string
  pageName: string
}

export interface Destination {
  id: string
  name: string
  type: 'gdoc' | 'notion'
}

export interface DocStat {
  count: number
  lastSavedAt: number   // Date.now() of the most recent clip
}

// Keyed by destination id (docId or 'notion'). Stored in chrome.storage.local.
export type DocStats = Record<string, DocStat>

export interface HistoryEntry {
  text: string           // truncated to 150 chars
  sourceTitle: string
  sourceUrl: string
  destinationName: string
  destinationId?: string // for the "Open in Doc" deep link; absent on pre-existing entries
  kind?: 'image'         // absent = text clip (only text clips get a source highlight)
  savedAt: number        // Date.now()
  note?: string          // optional personal annotation, if one was added
  namedRangeId?: string  // Docs NamedRange bookmark over this clip's block, for Living Resurface
  someday?: boolean      // soft triage: deprioritized without being deleted or hidden from the Doc
  cited?: boolean        // set once "⧉ Cite" successfully copies a citation for this clip
}

// A hyperlink found inside the selected text — character range into the clip's
// normalized text plus its destination URL, so the Doc keeps it clickable.
export interface LinkSpan {
  start: number
  end: number
  url: string
}

export interface SaveNoteMessage {
  type: 'SAVE_NOTE'
  payload: {
    text: string
    url: string
    title: string
    destinationId: string
    destinationType: 'gdoc' | 'notion'
    note?: string          // optional personal annotation ("your take")
    links?: LinkSpan[]      // hyperlinks to preserve inside the clip text
  }
}

// Background → content: the user right-clicked an image; grab its dimensions.
export interface CaptureImageMessage {
  type: 'CAPTURE_IMAGE'
  srcUrl: string
}

// Content → background: save an image into a destination.
export interface SaveImageMessage {
  type: 'SAVE_IMAGE'
  payload: {
    imageUrl: string
    width?: number         // natural px, if the content script could read it
    height?: number
    url: string
    title: string
    destinationId: string
    destinationType: 'gdoc' | 'notion'
  }
}

export interface SaveImageResponse {
  success: boolean
  error?: string
}

export interface SaveNoteResponse {
  success: boolean
  error?: string
}

export interface TriggerSaveMessage {
  type: 'TRIGGER_SAVE'
}

export interface ToggleDrawerMessage {
  type: 'TOGGLE_DRAWER'
}

export interface GetUserProfileMessage {
  type: 'GET_USER_PROFILE'
}

export interface GetUserProfileResponse {
  email: string
  // Requires the userinfo.profile OAuth scope — null for a token that
  // predates that scope (silently, until the user next signs in), not an error.
  name: string | null
}

export interface SignInMessage {
  type: 'SIGN_IN'
}

export interface SignInResponse {
  success: boolean
  email?: string
  name?: string | null
  error?: string
}

export interface SignOutMessage {
  type: 'SIGN_OUT'
}

export interface SignOutResponse {
  success: boolean
  error?: string
}

export interface GetDocTitleMessage {
  type: 'GET_DOC_TITLE'
  docId: string
}

export interface GetDocTitleResponse {
  title: string | null
}

// Popup → background: add a freshly dated note back into the Doc at a clip's
// bookmarked location. Works on any bookmarked clip, not just a Resurfaced one
// — the History UI just happens to be where this is triggered from.
// entrySavedAt identifies which local `clips` entry to patch afterward so the
// History card reflects it too.
export interface AddDocNoteMessage {
  type: 'ADD_DOC_NOTE'
  payload: {
    destinationId: string
    namedRangeId: string
    note: string
    entrySavedAt: number
  }
}

export interface AddDocNoteResponse {
  success: boolean
  error?: string
}

// Imperative handle the content script uses to drive the floating toolbar from
// page-level key presses (Enter to save, ←/→ to move the highlighted action).
// Returns true when the key was consumed so the caller can preventDefault.
export interface ToolbarApi {
  handleNavKey: (key: string) => boolean
}

// ── Voice-note capture (Toolbar's note panel → background → a real voice tab) ──
// Speech recognition runs in a real, visible tab (src/voice/), not a
// chrome.offscreen document — offscreen documents get an immediate
// NotAllowedError from getUserMedia with no permission dialog ever shown, a
// hard Chrome platform restriction confirmed live (not assumed): granting
// mic access via a separate real tab first, then retrying in the offscreen
// doc, still failed. A real tab is the one thing proven to work end to end.
//
//   Toolbar --START_VOICE_NOTE--> background --(chrome.tabs.create)--> voice tab
//   voice tab --VOICE_RECOGNITION_EVENT--> background --VOICE_NOTE_UPDATE (explicit frameId)--> Toolbar
//   Toolbar --STOP_VOICE_NOTE--> background --VOICE_TAB_STOP (explicit tabId)--> voice tab

export type VoiceEvent =
  | { kind: 'transcript'; text: string }
  | { kind: 'error'; error: string }
  | { kind: 'ended' }

export interface StartVoiceNoteMessage {
  type: 'START_VOICE_NOTE'
}
export interface StartVoiceNoteResponse {
  success: boolean
  error?: string
}

export interface StopVoiceNoteMessage {
  type: 'STOP_VOICE_NOTE'
}

// background → the specific voice tab it opened (chrome.tabs.sendMessage
// with that tab's id — never broadcast, so no other tab's listener can see
// this even coincidentally).
export interface VoiceTabStopMessage {
  type: 'VOICE_TAB_STOP'
}

// voice tab → background. The voice tab is opened in the background
// (active: false) so the user's focus stays on the page they're clipping
// from — they should see the note field fill in live, not stare at a
// separate tab. It only asks to be foregrounded the one time it actually
// needs the user's attention: granting the mic permission for the first
// time (or explaining a past denial), since Chrome's native prompt needs a
// visible, active tab to appear on. Once already granted, this is never sent.
export interface VoiceTabNeedsForegroundMessage {
  type: 'VOICE_TAB_NEEDS_FOREGROUND'
}

// voice tab → background. sender.tab is absent for messages from an
// offscreen document but IS present for a normal tab, so the background's
// listener distinguishes this from a stray content-script message by
// checking sender.tab.id against the voice tab it's currently tracking,
// not by sender shape.
export interface VoiceRecognitionEventMessage {
  type: 'VOICE_RECOGNITION_EVENT'
  event: VoiceEvent
}

export interface VoiceNoteUpdateMessage {
  type: 'VOICE_NOTE_UPDATE'
  event: VoiceEvent
}
