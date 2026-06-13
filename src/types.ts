export interface DocDestination {
  id: string    // Google Doc ID
  name: string  // user-given label e.g. "Study Notes"
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

export interface HistoryEntry {
  text: string           // truncated to 150 chars
  sourceTitle: string
  sourceUrl: string
  destinationName: string
  savedAt: number        // Date.now()
}

export interface SaveNoteMessage {
  type: 'SAVE_NOTE'
  payload: {
    text: string
    url: string
    title: string
    destinationId: string
    destinationType: 'gdoc' | 'notion'
  }
}

export interface SaveNoteResponse {
  success: boolean
  error?: string
}

export interface TriggerSaveMessage {
  type: 'TRIGGER_SAVE'
}
