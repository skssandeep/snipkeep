import type {
  OffscreenStartRecognitionMessage,
  OffscreenStopRecognitionMessage,
  VoiceEvent,
  VoiceRecognitionEventMessage,
} from '../types'

// Minimal local typing for the Web Speech API — not part of TypeScript's DOM
// lib (only the peripheral SpeechRecognitionResult/-Alternative interfaces
// are), so this covers just what's actually used here rather than reaching
// for `any` throughout.
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number; [i: number]: SpeechRecognitionResultLike }
}
interface SpeechRecognitionErrorEventLike {
  error: string
}
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

// Forgotten-open mic safety net — recognition.continuous keeps listening
// indefinitely on its own; this guarantees it can't run forever unnoticed.
const MAX_SESSION_MS = 90_000

let recognition: SpeechRecognitionLike | null = null
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function sendEvent(event: VoiceEvent) {
  chrome.runtime.sendMessage({ type: 'VOICE_RECOGNITION_EVENT', event } satisfies VoiceRecognitionEventMessage)
}

function clearMaxDurationTimer() {
  if (maxDurationTimer) { clearTimeout(maxDurationTimer); maxDurationTimer = null }
}

function startRecognition() {
  if (recognition) return  // already running — ignore a duplicate start

  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) {
    sendEvent({ kind: 'error', error: 'Voice input is not supported in this browser.' })
    return
  }

  recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-US'

  // Accumulates only the FINAL segments; interim (not-yet-final) text for the
  // current phrase is appended fresh on every event, never persisted, since
  // onresult re-fires with the same interim text growing — treating it as
  // additive would duplicate words.
  let finalText = ''
  recognition.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      const chunk = result[0].transcript
      if (result.isFinal) finalText += chunk + ' '
      else interim += chunk
    }
    sendEvent({ kind: 'transcript', text: (finalText + interim).trim() })
  }
  recognition.onerror = (e) => {
    // Chrome offscreen documents can never show the actual mic permission
    // dialog — every one of these three error codes fires immediately, with
    // no prompt ever shown, whether permission was never asked or was
    // explicitly denied in the past. Since this document has no visible
    // surface to explain or resolve that, ALL of them route to the same
    // recovery path: the background opens a real, visible tab, the only
    // place Chrome will actually show the prompt (or let the user fix a
    // past denial via the site-settings icon).
    if (e.error === 'not-allowed' || e.error === 'permission-denied' || e.error === 'service-not-allowed') {
      sendEvent({ kind: 'permission-needed' })
    } else {
      const message = e.error === 'no-speech' ? 'No speech detected.' : 'Voice input stopped unexpectedly.'
      sendEvent({ kind: 'error', error: message })
    }
    recognition = null
    clearMaxDurationTimer()
  }
  recognition.onend = () => {
    // Fires both for an explicit stop() and the engine's own silence timeout —
    // either way, the session is over; the Toolbar treats this uniformly.
    sendEvent({ kind: 'ended' })
    recognition = null
    clearMaxDurationTimer()
  }

  recognition.start()
  maxDurationTimer = setTimeout(() => recognition?.stop(), MAX_SESSION_MS)
}

function stopRecognition() {
  recognition?.stop()
}

chrome.runtime.onMessage.addListener((message: OffscreenStartRecognitionMessage) => {
  if (message.type !== 'OFFSCREEN_START_RECOGNITION') return false
  startRecognition()
  return false
})

chrome.runtime.onMessage.addListener((message: OffscreenStopRecognitionMessage) => {
  if (message.type !== 'OFFSCREEN_STOP_RECOGNITION') return false
  stopRecognition()
  return false
})
