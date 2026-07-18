// A real tab — the only place Chrome will actually show the getUserMedia
// permission dialog AND reliably let recognition keep running. chrome.
// offscreen documents were tried first (so no tab would need to exist at
// all); confirmed live that they get an immediate NotAllowedError with no
// prompt shown, and — critically — granting the permission via a *separate*
// real tab first didn't make a subsequent offscreen attempt succeed either.
// A real tab is the one thing proven to work end to end.
//
// Opened in the BACKGROUND (background/index.ts's chrome.tabs.create with
// active: false) — the user should stay on the page they're clipping from
// and watch the note field fill in live, not have their view yanked to a
// separate tab. This only asks to be foregrounded the one time it actually
// needs the user's attention: granting mic permission for the first time,
// since Chrome's native dialog needs a visible, active tab to appear on at
// all. Checked via navigator.permissions.query BEFORE calling getUserMedia,
// so the decision to foreground happens ahead of time, not as a reaction to
// a prompt that a backgrounded tab might not even be able to show.
// See CLAUDE.md's "Voice tab" section for the full message-flow design.

import type {
  VoiceEvent,
  VoiceRecognitionEventMessage,
  VoiceTabStopMessage,
  VoiceTabNeedsForegroundMessage,
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

// Two tunings, selected once at startup by the ?mode=teach URL param
// (threaded from StartVoiceNoteMessage.payload.longForm by the background):
// the default is the original short margin-note behavior; teach mode is
// Teach-It-Back's long-form dictation, where a multi-second thinking pause
// mid-explanation must NOT read as "done" and a real explanation needs far
// more than 90 seconds.
const TEACH_MODE = new URLSearchParams(window.location.search).get('mode') === 'teach'

// Forgotten-open mic safety net — recognition.continuous keeps listening
// indefinitely on its own; this guarantees the tab can't sit there listening
// forever unnoticed. Outer bound regardless of speech activity.
const MAX_SESSION_MS = TEACH_MODE ? 300_000 : 90_000

// Auto-stop design (see the psychology note in CLAUDE.md's "Voice tab"
// section): continuous stays true so a mid-thought pause doesn't cut
// someone off, but a pause this long after they've clearly finished talking
// is treated as "done" — matching the mental model every voice assistant
// already trains people on (Siri, Google Assistant, ChatGPT voice), rather
// than requiring a second click to explicitly stop. Longer grace period
// before ANY speech has been heard yet (give someone time to start), much
// shorter once they've been talking and then go quiet (that pause IS the
// "I'm finished" signal).
const INITIAL_SILENCE_MS = 8_000
const PAUSE_SILENCE_MS = TEACH_MODE ? 5_000 : 1_800
// Cosmetic only — reassures anyone who does see this tab that it's still
// working during the initial grace period, distinguishing "quiet, still
// listening" from "broken." Comfortably before INITIAL_SILENCE_MS expires.
const STILL_LISTENING_HINT_MS = 3_500

const micEl = document.getElementById('mic') as HTMLDivElement
const headingEl = document.getElementById('heading') as HTMLHeadingElement
const hintEl = document.getElementById('hint') as HTMLParagraphElement
const transcriptEl = document.getElementById('transcript') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLDivElement

let recognition: SpeechRecognitionLike | null = null
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let stillListeningTimer: ReturnType<typeof setTimeout> | null = null

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

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
  if (stillListeningTimer) { clearTimeout(stillListeningTimer); stillListeningTimer = null }
}

// Restarts the "how long has it been quiet" clock — called once when
// recognition starts (the longer initial grace period) and again on every
// speech update (the much shorter post-speech pause).
function resetSilenceTimer(timeoutMs: number, showStillListeningHint: boolean) {
  clearSilenceTimer()
  silenceTimer = setTimeout(() => recognition?.stop(), timeoutMs)
  if (showStillListeningHint) {
    stillListeningTimer = setTimeout(() => {
      hintEl.textContent = 'Still listening — go ahead and speak.'
    }, STILL_LISTENING_HINT_MS)
  }
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
  hintEl.textContent = 'Speak your note. Pause when you\'re done — it stops on its own.'
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
    // Any speech at all resets the clock to the short post-speech window —
    // the next silence long enough to matter is "I'm done," not "still
    // getting started," so no more need for the reassurance hint either.
    resetSilenceTimer(PAUSE_SILENCE_MS, false)
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
    clearSilenceTimer()
    closeShortly(1200)
  }
  recognition.onend = () => {
    // Fires for an explicit stop(), the silence-timeout stop() above, or the
    // engine's own internal timeout — all the same from here: the session
    // is over, and the Toolbar treats every case identically.
    sendEvent({ kind: 'ended' })
    recognition = null
    clearMaxDurationTimer()
    clearSilenceTimer()
    closeShortly()
  }

  recognition.start()
  maxDurationTimer = setTimeout(() => recognition?.stop(), MAX_SESSION_MS)
  resetSilenceTimer(INITIAL_SILENCE_MS, true)
}

async function init() {
  // Decide BEFORE calling getUserMedia whether the user needs to actually
  // see this tab — a backgrounded tab may not be able to show Chrome's
  // native permission dialog at all, so foregrounding has to happen ahead
  // of the prompt, not as a reaction to one. If the query itself fails for
  // any reason, foreground defensively — an unnecessary foreground is a
  // minor annoyance; failing to foreground when it was actually needed
  // leaves the user stuck looking at a tab they can't interact with.
  try {
    const status = await navigator.permissions.query({ name: 'microphone' })
    if (status.state !== 'granted') {
      chrome.runtime.sendMessage({ type: 'VOICE_TAB_NEEDS_FOREGROUND' } satisfies VoiceTabNeedsForegroundMessage)
    }
  } catch {
    chrome.runtime.sendMessage({ type: 'VOICE_TAB_NEEDS_FOREGROUND' } satisfies VoiceTabNeedsForegroundMessage)
  }

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
