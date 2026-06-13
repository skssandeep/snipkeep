# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # build in watch mode (auto-rebuilds on file save)
npm run build    # production build → dist/
npm run zip      # package dist/ into clipnote.zip for distribution
```

No tests or linter configured. TypeScript type-checking is enforced at build time via Vite.

After every build, reload the extension in Chrome: `chrome://extensions` → ClipNote → refresh icon. Then refresh the tab you're testing on — content scripts from the old build keep running until the tab reloads.

## Architecture

Manifest V3 Chrome extension. Vite + `vite-plugin-web-extension` reads `manifest.json` and compiles all referenced source paths into `dist/`.

### Three isolated execution contexts

**Background** (`src/background/index.ts`) — MV3 service worker. Handles all API calls (Google Docs, Notion), OAuth via `chrome.identity`, per-destination URL tracking, and history. Can be killed and restarted by Chrome at any time — never rely on in-memory state; use `chrome.storage.session` for session-scoped data.

**Content script** (`src/content/index.tsx`) — injected into every page except `docs.google.com`. Does three things:
1. Listens for `mouseup` (250ms debounce) to detect text selection and renders the floating toolbar.
2. Listens for `TOGGLE_DRAWER` messages to open/close the right-side settings drawer.
3. Listens for `TRIGGER_SAVE` messages (keyboard shortcut Cmd+Shift+S) to save without the toolbar.

**Popup UI** (`src/popup/`) — React app (`Popup.tsx` + `popup.css`). Rendered in two places: inside the drawer injected by the content script (primary), and as `popup.html` (entry point kept for build, but `"default_popup"` is removed from `manifest.json` so the icon click fires `chrome.action.onClicked` instead).

### Drawer

`src/content/Drawer.tsx` injects the full Popup UI as a right-side drawer into a Shadow DOM host (`#clipnote-drawer-host`). It uses two `<style>` tags injected in order:
1. `POPUP_CSS` — popup.css with `:root` replaced by `:host` and `body` replaced by `.cn-popup-root`
2. `DRAWER_CSS` — drawer shell styles that override popup defaults

Injection order matters: POPUP_CSS first so DRAWER_CSS rules win at equal specificity. The drawer exposes a `closeRef` (MutableRefObject) so the content script can trigger the slide-out animation before unmounting.

### Message flow

```
Icon click → background chrome.action.onClicked → TOGGLE_DRAWER → content script → Drawer
Selection + save → content script → SAVE_NOTE → background → Google Docs / Notion API
Cmd+Shift+S → background chrome.commands → TRIGGER_SAVE → content script
```

All message types are in `src/types.ts`.

### Shadow DOM pattern

Both the toolbar (`#clipnote-host`) and drawer (`#clipnote-drawer-host`) are Shadow DOM roots. Key consequences:
- Use `e.composedPath()` (not `e.target`) to detect clicks inside shadow roots from the outer document.
- CSS variables defined on `:host` are available inside the shadow tree.
- `pointer-events: none` on the host element; toolbar overflows it visually.

### Storage layout

| Store | Key | Value |
|---|---|---|
| `chrome.storage.sync` | `docs` | `DocDestination[]` — list of Google Doc destinations with `active` flag |
| `chrome.storage.sync` | `notionConfig` | `NotionConfig` — token + pageId + pageName |
| `chrome.storage.sync` | `defaultDestId` | `string` — last used destination ID |
| `chrome.storage.sync` | `isSignedIn` | `boolean` |
| `chrome.storage.session` | `lastSavedUrls` | `Record<destId, url>` — per-destination last saved URL |
| `chrome.storage.local` | `history` | `HistoryEntry[]` — last 10 clips |

Legacy: `docId` (string) in sync storage is the old single-doc format. Both background and content script migrate it to `docs: [{ id, name: 'My Notes', active: true }]` on read.

The `active` flag on `DocDestination` controls whether a doc appears in the toolbar. Inactive docs are stored but hidden from the selection UI — toggled via a switch in the drawer.

### Google Docs formatting

On each save, the background does a GET to find the document's `endIndex`, then a `batchUpdate` with requests processed in order:

**New article** (URL differs from last saved URL for that destination):
1. `insertText` — `"${pageTitle}\n ${domain} \n\n${text}\n\n"` at `endIndex - 1`
2. `updateParagraphStyle` — title → `HEADING_2`
3. `updateTextStyle` — domain chip: light blue background (`#e0eeff`), blue foreground, 9pt, hyperlinked, `underline: false`
4. `createParagraphBullets` — text range → `BULLET_DISC_CIRCLE_SQUARE`

**Same article** (same URL, continuing session):
1. `insertText` — `"${text}\n\n"`
2. `createParagraphBullets` — text range → `BULLET_DISC_CIRCLE_SQUARE`

### Text normalisation

`normalizeSelectionText()` in `content/index.tsx` runs on every captured selection before it's sent anywhere:
- Single `\n` → space (visual line-wrap in large headings; not a real paragraph break)
- `\n\n` → preserved as `\n` (true paragraph break → becomes a separate bullet in the doc)
