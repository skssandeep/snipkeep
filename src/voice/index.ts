// A real, visible tab — the only place Chrome will actually show the
// getUserMedia permission dialog AND reliably let recognition keep running.
// chrome.offscreen documents were tried first for this (so no visible tab
// would need to appear at all); confirmed live that they get an immediate
// NotAllowedError with no prompt shown, and — critically — granting the
// permission via a *separate* real tab first didn't make a subsequent
// offscreen attempt succeed either. A real tab is the one thing proven to
// work end to end, so recognition itself now happens right here.
// See CLAUDE.md's "Voice tab" section for the full message-flow design.

import type {
  VoiceEvent,
  VoiceRecognitionEventMessage,
  VoiceTabStopMessage,
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
// indefinitely on its own; this guarantees the tab can't sit there listening
// forever unnoticed.
const MAX_SESSION_MS = 90_000

const micEl = document.getElementById('mic') as HTMLDivElement
const headingEl = document.getElementById('heading') as HTMLHeadingElement
const hintEl = document.getElementById('hint') as HTMLParagraphElement
const transcriptEl = document.getElementById('transcript') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLDivElement

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

function closeShortly(delayMs = 500) {
  setTimeout(() => window.close(), delayMs)
}

function startRecognition() {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) {
    sendEvent({ kind: 'error', error: 'Voice input is not supported in this browser.' })
    statusEl.textContent = 'Voice input is not supported in this browser.'
    statusEl.className = 'status err'
    closeShortly(1500)
    return
  }

  headingEl.textContent = 'Listening…'
  hintEl.textContent = 'Speak your note. Close this tab or click the mic button again in SnipKeep to stop.'
  micEl.classList.add('listening')

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
    const text = (finalText + interim).trim()
    transcriptEl.textContent = text
    sendEvent({ kind: 'transcript', text })
  }
  recognition.onerror = (e) => {
    const message = e.error === 'not-allowed' || e.error === 'permission-denied' || e.error === 'service-not-allowed'
      ? 'Microphone permission was denied.'
      : e.error === 'no-speech'
        ? 'No speech detected.'
        : 'Voice input stopped unexpectedly.'
    sendEvent({ kind: 'error', error: message })
    statusEl.textContent = message
    statusEl.className = 'status err'
    recognition = null
    clearMaxDurationTimer()
    closeShortly(1200)
  }
  recognition.onend = () => {
    // Fires both for an explicit stop() and the engine's own silence
    // timeout — either way the session is over; the Toolbar treats both
    // the same way.
    sendEvent({ kind: 'ended' })
    recognition = null
    clearMaxDurationTimer()
    closeShortly()
  }

  recognition.start()
  maxDurationTimer = setTimeout(() => recognition?.stop(), MAX_SESSION_MS)
}

async function init() {
  try {
    // Requesting this here is what lets Chrome actually show its native
    // dialog (a real tab, unlike an offscreen document) — or resolve
    // instantly with no prompt at all if already granted from a prior
    // session, since the grant is scoped to this extension's origin.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => track.stop())  // only needed the grant
    startRecognition()
  } catch {
    // Chrome won't re-show its native prompt after an explicit denial — the
    // only way back is the site's own permission control in the address bar.
    headingEl.textContent = 'Microphone access needed'
    hintEl.textContent = ''
    statusEl.textContent = "Access wasn't granted. Click the lock/info icon in the address bar → Site settings → Microphone → Allow, then reload this tab."
    statusEl.className = 'status err'
    sendEvent({ kind: 'error', error: 'Microphone permission was denied.' })
  }
}

chrome.runtime.onMessage.addListener((message: VoiceTabStopMessage) => {
  if (message.type !== 'VOICE_TAB_STOP') return false
  recognition?.stop()
  return false
})

init()
