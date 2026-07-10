// Lecture-timestamp clipping (YouTube). Shared by the content script (which
// detects the moment), the background (which writes the timestamp link into
// the Doc), and the popup (whose Source link deep-links to the moment).
//
// The timestamp deliberately travels as its own field (`videoTime`, seconds),
// NEVER baked into the clip's sourceUrl — sourceUrl doubles as the page's
// IDENTITY in several places (article-grouping in the Doc, Works Cited dedup,
// archive keying, reflection-nudge streaks), and a per-clip `t=` param would
// make every clip from one lecture look like a different page.

// 43:21 or 1:02:45 — the format YouTube itself shows.
export function formatVideoTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

// The canonical page URL + a moment → a link that opens the video already
// playing at that moment.
export function timedVideoUrl(url: string, seconds: number): string {
  try {
    const u = new URL(url)
    u.searchParams.set('t', `${Math.max(0, Math.floor(seconds))}s`)
    return u.toString()
  } catch {
    return url
  }
}
