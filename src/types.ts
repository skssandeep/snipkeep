export interface DocDestination {
  id: string
  name: string
  active: boolean  // false = stored but hidden from toolbar
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

export interface ToggleDrawerMessage {
  type: 'TOGGLE_DRAWER'
}
