// A real, visible tab — the only place Chrome will actually show the
// getUserMedia permission dialog. chrome.offscreen documents (where
// SpeechRecognition actually runs for voice notes) get an immediate,
// no-prompt NotAllowedError instead; this page exists purely to get the
// permission granted once, after which the offscreen doc can use it freely
// (same extension origin). See CLAUDE.md's "Offscreen document" section.

const statusEl = document.getElementById('status') as HTMLDivElement

async function requestMicAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // Only needed the grant, not the stream itself.
    stream.getTracks().forEach(track => track.stop())
    statusEl.textContent = '✓ All set — you can close this tab and try the mic button again.'
    statusEl.className = 'status ok'
    setTimeout(() => window.close(), 1800)
  } catch {
    // Chrome won't re-show the native prompt after an explicit denial — the
    // only way back is the site's own permission control in the address bar.
    statusEl.textContent = "Access wasn't granted. Click the lock/info icon in the address bar → Site settings → Microphone → Allow, then reload this tab."
    statusEl.className = 'status err'
  }
}

requestMicAccess()
