# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # build in watch mode (auto-rebuilds on file save)
npm run build    # production build → dist/
npm run zip      # package dist/ into clipnote.zip for distribution
```

There are no tests or linter configured. TypeScript type-checking is enforced at build time via Vite.

After every build, reload the extension in Chrome: `chrome://extensions` → ClipNote → refresh icon. Then refresh the tab you're testing on (content scripts from the old build are still running until the tab reloads).

## Architecture

This is a Manifest V3 Chrome extension. Vite + `vite-plugin-web-extension` handles the multi-entry build — it reads `manifest.json` and compiles all referenced source paths (`src/background/index.ts`, `src/content/index.tsx`, `src/popup/index.html`) into `dist/`.

### Three isolated execution contexts

**Background** (`src/background/index.ts`) — MV3 service worker. Handles all API calls (Google Docs, Notion), OAuth via `chrome.identity`, per-destination URL tracking, and history. Runs in a separate context with no DOM access. Can be killed and restarted by Chrome at any time — do not rely on in-memory state; use `chrome.storage.session` for session-scoped state.

**Content script** (`src/content/index.tsx`) — injected into every page except `docs.google.com`. Listens for `mouseup` (with 250ms debounce) to detect text selection, then renders the floating toolbar. Communicates with the background via `chrome.runtime.sendMessage`. Excluded from Google Docs to prevent save loops.

**Popup** (`src/popup/`) — React app shown when the extension icon is clicked. Two tabs: Settings (manage Google Docs destinations, Notion config, Google sign-in) and History (last 10 saved clips from `chrome.storage.local`).

### Message flow

```
Content script → SAVE_NOTE → Background → Google Docs API / Notion API
Background → TRIGGER_SAVE → Content script (keyboard shortcut Cmd+Shift+S)
```

All message types are defined in `src/types.ts`.

### Toolbar rendering

The toolbar is a React component injected into a **Shadow DOM** host element (`#clipnote-host`) on the page. Shadow DOM isolates its styles from the host page's CSS. The host element is `position: absolute`, `width: 0`, `height: 0`, `pointer-events: none` — the toolbar overflows it visually. This means `e.composedPath()` must be used (not `e.target`) to detect clicks inside the toolbar, since shadow DOM children don't appear in the regular DOM tree.

### Storage layout

| Store | Key | Value |
|---|---|---|
| `chrome.storage.sync` | `docs` | `DocDestination[]` — named Google Doc destinations |
| `chrome.storage.sync` | `notionConfig` | `NotionConfig` — token + pageId + pageName |
| `chrome.storage.sync` | `defaultDestId` | `string` — last used destination ID |
| `chrome.storage.sync` | `isSignedIn` | `boolean` |
| `chrome.storage.session` | `lastSavedUrls` | `Record<destId, url>` — per-destination last saved URL for article grouping |
| `chrome.storage.local` | `history` | `HistoryEntry[]` — last 10 clips |

Legacy: `docId` (string) in sync storage is the old single-doc format. Both background and content script migrate it to `docs: [{ id, name: 'My Notes' }]` on read.

### Google Docs formatting

Notes are appended using `batchUpdate`. When the URL changes from the last saved URL for that destination, a `HEADING_2` paragraph is inserted with the page title and a `[source]` link (9pt, blue). Subsequent clips from the same URL are appended as plain paragraphs. The insertion point is always `endIndex - 1` of the body (just before the document's final `\n`), retrieved via a prior GET call.
