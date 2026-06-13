export interface SaveNoteMessage {
  type: 'SAVE_NOTE'
  payload: {
    text: string
    url: string
    title: string
  }
}

export interface SaveNoteResponse {
  success: boolean
  error?: string
}

export interface TriggerSaveMessage {
  type: 'TRIGGER_SAVE'
}

export interface ExtensionStorage {
  docId: string
  isSignedIn: boolean
}
