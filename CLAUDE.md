# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is the fast architectural reference.** For how a specific feature works in detail, see `docs/FEATURES.md`. For shipped/remaining status and the reasoning behind the roadmap, see `docs/ROADMAP.md`.

## Commands

```bash
npm run dev      # build in watch mode (auto-rebuilds on file save)
npm run build    # production build → dist/
npm run zip      # package dist/ into snipkeep.zip for distribution
```

No tests or linter configured. **`npm run build` does NOT type-check** — `vite-plugin-web-extension` transpiles via esbuild, which strips types silently. `tsconfig` has `strict` + `noUnusedLocals`/`noUnusedParameters`, but those only bite if you run the type-checker yourself: use **`./node_modules/.bin/tsc --noEmit`** directly, not `npx tsc` — `npx` has, at least once, resolved to an unrelated registry package literally named `tsc` instead of this project's TypeScript. Known **pre-existing** tsc errors that esbuild ignores (leave them unless fixing that area): `getAuthToken`/`getAuthTokenSilent` (`@types/chrome` now types the callback as `GetAuthTokenResult`, not `string`), `popup.css?inline` (no ambient module decl), and an unused `React` import in `Popup.tsx`.

After every build, reload at `chrome://extensions` → SnipKeep → refresh icon, then refresh the tab you're testing — old content scripts keep running until the tab reloads. **Changing `manifest.json` permissions requires a full reload** (Chrome won't pick them up otherwise — this includes `contextMenus`, `clipboardWrite`, and the `web.archive.org` host permission).

**A note on this Bash environment:** the working directory has drifted mid-session more than once (a command run from `clipnote/` later reports `pwd` as its parent). Chain `cd /path/to/clipnote && pwd && <command>` in one call rather than trusting directory persistence across separate tool calls.

## Architecture

Manifest V3 Chrome extension. Vite + `vite-plugin-web-extension` reads `manifest.json` and compiles every referenced source path into `dist/`. `public/` (icons, bundled font) is copied to `dist/` root. `@/*` aliases `src/*`.

What SnipKeep does: select text on any page → a floating toolbar saves it to a chosen Google Doc; a right-side drawer manages destinations and history. The **Google Doc is the real product** — formatting quality there matters most, and there is no SnipKeep server or database — everything lives in the user's own Doc or on-device. That architectural fact is the whole thesis behind the roadmap in `docs/ROADMAP.md`; don't build a feature that quietly undoes it.

The clip is more than plain text: an optional **margin note** ("your take"), preserved hyperlinks, right-click image capture, a keyboard-driven toolbar, full-text-searchable history with citations, and a growing set of behavioral-psychology-informed features (deadlines, triage, resurfacing) — see `docs/ROADMAP.md` for the full list and `docs/FEATURES.md` for mechanics.

> Naming: the product was renamed **ClipNote → SnipKeep**. The wordmark is rendered as two colored spans — `Snip` (white) + `Keep` (accent violet) — in `Drawer.tsx` and `Popup.tsx`, so it never exists as the joined string "SnipKeep" in JSX. Internal ids use the `snipkeep-` prefix; the signing key is `snipkeep-key.pem` (gitignored; the extension id comes from the `key` field in `manifest.json`, which is unchanged).

### Three isolated execution contexts

**Background** (`src/background/index.ts`) — MV3 service worker. All API calls (Google Docs; Notion code exists but is hidden at MVP), OAuth via `chrome.identity`, history, per-destination tracking, and **all `chrome.identity` work** (see gotcha below). Can be killed/restarted anytime — never rely on in-memory state; persist to `chrome.storage`.

**Content script** (`src/content/index.tsx`) — injected into every page except `docs.google.com`. Guarded against double-injection via `window.__snipkeepLoaded`. Renders the floating **Toolbar** on `mouseup` (250ms debounce), opens/closes the **Drawer** on `TOGGLE_DRAWER`, saves directly on `TRIGGER_SAVE` (Cmd/Ctrl+Shift+S) with a toast, drives the toolbar from page-level keys, extracts preserved links (`extractLinkSpans`), and handles `CAPTURE_IMAGE`.

**Popup UI** (`src/popup/`) — React app (`Popup.tsx` + `popup.css`). Rendered primarily *inside the drawer*; `popup.html` is kept as a build entry but `default_popup` is removed so the icon fires `chrome.action.onClicked`. **Three tabs: Docs** (`DocsTab` — active destinations only, `docs.filter(d => !d.done)`), **Completed** (`CompletedTab` — finished projects), and **History** (the clip archive — search, citations, tags; ✨ Resurfaced exists in code but is currently paused, see `docs/ROADMAP.md`). See `docs/FEATURES.md` for the mechanics of each.

### `chrome.identity` is NOT available in content scripts (the #1 gotcha)

The drawer (and the Popup it renders) runs in the **content-script** context, where `chrome.identity` is `undefined`. Any identity/auth/Docs-token work from the drawer must be routed to the background via `chrome.runtime.sendMessage`. Handlers:
- `GET_USER_EMAIL` → avatar email (`getProfileUserInfo`)
- `GET_DOC_TITLE` → resolve a Doc's title (silent token + Docs API)
- `SIGN_IN` (gate screen) → interactive OAuth + cache email
- `SIGN_OUT` (drawer) → `removeCachedAuthToken` + clear `isSignedIn`/`userEmail`

Background auth helpers: `getAuthToken()` (interactive) and `getAuthTokenSilent()` (non-interactive, never prompts). Sign-out: `Drawer.handleSignOut` sends `SIGN_OUT` and optimistically clears the avatar; the `chrome.storage` change flips `isSignedIn` → the gate screen. (`SIGN_OUT` only drops Chrome's cached token, not the Google-side grant, so re-sign-in is a fast silent re-grant.)

The avatar dropdown also has a **🔒 Privacy** entry and, on first use, a **Trust Card** — see `docs/FEATURES.md` for both.

### Drawer (Radix Sheet in Shadow DOM)

`src/content/Drawer.tsx` mounts the Popup as a right-side sheet built on `@radix-ui/react-dialog` (wrapped in `src/components/ui/sheet.tsx`). Key adaptations:
- **`modal={false}`** + `onInteractOutside` prevented + no overlay — SnipKeep is a *companion*: the page must stay scrollable/interactive, and the drawer stays open until closed via ✕ / Esc / icon toggle.
- Radix portals to `document.body` by default; `SheetContent` takes a `container` prop so the portal stays inside the Shadow DOM.
- Closing runs one path (`close()` in Drawer): set `open=false` to play the slide-out, then unmount after ~240ms. `closeRef` lets the content script trigger it.
- **Three `<style>` tags injected in order**: `POPUP_CSS` (popup.css `?inline`, `:root`→`:host`, `body`→`.cn-popup-root`), then `SHEET_CSS`, then `BODY_CSS` (drawer chrome).

### Fonts (bundled, not Google Fonts)

Plus Jakarta Sans is bundled at `public/fonts/plus-jakarta-sans.woff2` (one variable file, 400–800). External `@import` is blocked by strict page CSPs inside content scripts, so it's exposed via `web_accessible_resources` and loaded by `ensureFontLoaded()` (`src/lib/fonts.ts`), which injects the `@font-face` into **`document.head`** (NOT a shadow root — Chrome doesn't reliably apply shadow-scoped `@font-face`). Called from `content/index.tsx`, `Drawer.tsx`, and `popup/main.tsx`.

### Icon click → drawer (with inject-on-demand)

`chrome.action.onClicked` messages the tab with `TOGGLE_DRAWER`. Tabs opened *before* the extension loaded have no content script, so on failure the background injects `src/content/index.js` via `chrome.scripting.executeScript` and retries. On restricted pages (New Tab, `chrome://`, Web Store, PDF viewer) injection is impossible → a `chrome.notifications` message explains why. The right-click "Save image" context menu uses the same inject-on-demand fallback.

### Message flow

```
Icon click   → background onClicked      → TOGGLE_DRAWER (+ inject-on-demand fallback) → content → Drawer
Cmd+Shift+S  → background commands       → TRIGGER_SAVE  → content (direct save + toast)
Save text    → content → SAVE_NOTE        → background → Google Docs API   (text, note, links)
Save image   → background contextMenus.onClicked → CAPTURE_IMAGE → content (read img size/title)
             → content → SAVE_IMAGE       → background → Google Docs API   (insertInlineImage)
Add doc note → content → ADD_DOC_NOTE     → background → Google Docs API   (Living Resurface write-back)
Drawer auth  → content → GET_USER_EMAIL / GET_DOC_TITLE / SIGN_IN / SIGN_OUT → background (chrome.identity)
```
All message types are in `src/types.ts`.

### Storage layout

| Store | Key | Value |
|---|---|---|
| `sync` | `docs` | `DocDestination[]` — `{ id, name, active, dueDate?, done? }` |
| `sync` | `defaultDestId` | last used destination ID |
| `sync` | `isSignedIn` / `userEmail` | auth state + cached email for the avatar |
| `sync` | `notionConfig` | Notion token/page (hidden at MVP) |
| `sync` | `citationStyle` | APA/MLA/BibTeX preference |
| `sync` | `hasSeenTrustCard` | gates the one-time Trust Card |
| `local` | `clips` | `HistoryEntry[]` — the full archive (newest first, capped at `ARCHIVE_MAX = 1000`). Seeded from legacy `history`. |
| `local` | `history` | **Legacy** last-10 store — read only as the seed/fallback for `clips`. |
| `local` | `docStats` | `Record<destId, {count, lastSavedAt}>` — the per-doc "Last clip … · N total" line |
| `local` | `lastSavedUrls` | `Record<destId, url>` — last-clip URL per dest, drives article-grouping |
| `local` | `archivedUrls` | `Record<pageUrl, snapshotUrl>` — Link-Rot Insurance |
| `local` | `docCaptionBookmarks` | `Record<pageUrl, Record<destId, namedRangeId>>` — link-rot write-back target |
| `local` | `triageDismissedDay` / `reflectionNudgeDismissed` | Soft Triage / Reflection Nudge dismissal state |

`HistoryEntry` fields beyond the basics: `note?`, `namedRangeId?` (Doc bookmark), `someday?`, `cited?`. Legacy `docId` (string, sync) is migrated to `docs: [{ id, name, active }]` on read in both background and content script.

### Design system / visual hierarchy

Tokens live in `popup.css` `:root` — warm-near-black surfaces + one electric-violet accent (`--accent #A99CFF`) + semantic state colors `--danger` (red) and `--warn` (amber), kept separate from the accent. Two accent-tint helpers: `--accent-dim` (0.10 — focus-ring glow / flash fill) and `--accent-soft` (0.14 — **the** "active pill" fill; every selected chip/toggle/cite-option must use it, never a hand-rolled `rgba(169,156,255,…)`, or they drift). Text ramp `--text` / `--text-2` / `--text-3` is **WCAG-locked** (don't dim `--text-3` below `#948FA1` — it fails 4.5:1 on cards). Hierarchy is carried by a 4-tier type scale + weight + color together; accent reserved for ~4 tiny spots. Avoid one-off font-size bumps — they flatten the scale.

**Spacing:** a 4px-grid scale lives in `:root` as `--space-1`…`--space-6` (4/8/12/16/20/24). Gaps, padding, and margins should reference these, not raw px. Do **not** stack a child `margin-bottom` on top of a parent flex `gap` — that double-spaces (History's control cluster hit exactly this: `gap:22` + per-child margins → 32–34px real gaps). Group related controls under one wrapper with its own `gap` (proximity) instead. Content cards (`.doc-item`/`.history-item`/`.account-row`/`.privacy-item`/`.triage-card`) all share `var(--space-3) var(--space-4)` padding.

**Tab switching:** the three tabs are distinct components, so switching unmounts one and mounts the next — `.tab-content` therefore carries a mount entrance animation (`cn-tab-in`, fade + 6px settle) that fires exactly on switch, gated behind `prefers-reduced-motion`. No key or extra state needed; don't add a shared persistent wrapper around the tabs or the animation stops firing.

**Gotcha:** `Toolbar.tsx` and the toast (`content/index.tsx`) are separate Shadow DOM roots that **hardcode hex values** (no access to the CSS variables). When tokens change, update those by hand or they silently drift out of WCAG sync.

**Icons:** `react-icons/md` (Google's Material Design set) is the icon system across `Popup.tsx`, `Drawer.tsx`, and `Toolbar.tsx` — replaced an earlier mix of emoji (🔒✨🕒📄🏛💭📋, inconsistent across OS/platform, colorful against a monochrome UI) and plain Unicode glyphs. Chosen over bundling Google's actual Material Symbols variable font (which would ship every icon in one large file just to use ~20) — `react-icons` tree-shakes per-icon like `lucide-react` already does elsewhere in this codebase; the entire sweep (~25 call sites, 17 distinct icons) added **~8.7KB** to the bundle. Icons render with `fill="currentColor"`, so they inherit each button's existing text color automatically — no separate color wiring needed, including in Toolbar's hardcoded-hex context. `lucide-react` is still used for two things deliberately left alone: `Bookmark` (Drawer's logo mark — brand identity, not a utility icon) and `sheet.tsx`'s `XIcon` (dead code — `Drawer.tsx` passes `showClose={false}`, so it never renders; SnipKeep has its own close button already).

### Shadow DOM notes

Toolbar (`#snipkeep-host`) and drawer (`#snipkeep-drawer-host`) are Shadow roots. Use `e.composedPath()` (not `e.target`) to detect clicks from the outer document; CSS vars on `:host` are visible inside; host has `pointer-events: none` and the toolbar overflows it.
