// Plus Jakarta Sans is bundled as a web_accessible_resource so it loads on every
// site regardless of the page's Content-Security-Policy (external @import from
// Google Fonts is blocked by strict CSPs like GitHub's inside content scripts).
// It's a variable font — one file covers the full 400–800 weight range.
export function fontFaceCss(): string {
  const url = chrome.runtime.getURL('fonts/plus-jakarta-sans.woff2')
  return `
    @font-face {
      font-family: 'Plus Jakarta Sans';
      font-style: normal;
      font-weight: 400 800;
      font-display: swap;
      src: url('${url}') format('woff2');
    }
  `
}

const FONT_STYLE_ID = 'snipkeep-font-face'

// @font-face must live in the light DOM (document head) — Chrome does not reliably
// apply @font-face declared inside a shadow root. Once registered at the document
// level the font is usable inside any shadow tree via font-family. Idempotent.
export function ensureFontLoaded() {
  if (document.getElementById(FONT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = FONT_STYLE_ID
  style.textContent = fontFaceCss()
  document.head.appendChild(style)
}
