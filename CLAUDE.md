# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # build in watch mode (auto-rebuilds on file save)
npm run build    # production build → dist/
npm run zip      # package dist/ into snipkeep.zip for distribution
```

No tests or linter configured. **`npm run build` does NOT type-check** — `vite-plugin-web-extension` transpiles via esbuild, which strips types silently. `tsconfig` has `strict` + `noUnusedLocals`/`noUnusedParameters`, but those only bite if you run `npx tsc --noEmit` yourself. Do that before trusting a change. Known **pre-existing** tsc errors that esbuild ignores (leave them unless fixing that area): `getAuthToken`/`getAuthTokenSilent` (`@types/chrome` now types the callback as `GetAuthTokenResult`, not `string`), `popup.css?inline` (no ambient module decl), and an unused `React` import in `Popup.tsx`.

After every build, reload at `chrome://extensions` → SnipKeep → refresh icon, then refresh the tab you're testing — old content scripts keep running until the tab reloads. **Changing `manifest.json` permissions requires a full reload** (Chrome won't pick them up otherwise — this includes the `contextMenus` permission).

## Architecture

Manifest V3 Chrome extension. Vite + `vite-plugin-web-extension` reads `manifest.json` and compiles every referenced source path into `dist/`. `public/` (icons, bundled font) is copied to `dist/` root. `@/*` aliases `src/*`.

What SnipKeep does: select text on any page → a floating toolbar saves it to a chosen Google Doc; a right-side drawer manages destinations and history. The **Google Doc is the real product** — formatting quality there matters most.

The clip is more than plain text: you can attach an optional **margin note** ("your take"), **hyperlinks inside the selection are preserved**, and you can **right-click an image → "Save image to SnipKeep"** to drop it into the same running Doc. The toolbar is also keyboard-driven (Enter saves, ←/→ move between its actions).

> Naming: the product was renamed **ClipNote → SnipKeep**. The wordmark is rendered as two colored spans — `Snip` (white) + `Keep` (accent violet) — in `Drawer.tsx` and `Popup.tsx`, so it never exists as the joined string "SnipKeep" in JSX. Internal ids use the `snipkeep-` prefix; the signing key is `snipkeep-key.pem` (gitignored; the extension id comes from the `key` field in `manifest.json`, which is unchanged).

### Feature set & open follow-ups

Built so far: **multi-Doc destinations** (toggleable) · **smart article grouping** in the Doc · **living archive** (all clips in `clips`, full-text search, ✨ Resurfaced daily spotlight via `pickResurfaced`) · **per-doc stats** · **history navigation** (↗ Source jumps to & highlights the clip via a Text Fragment; 📄 Doc opens the Google Doc) · **auto-citation** (⧉ Cite copies APA/MLA/BibTeX to clipboard; style toggle persisted as `citationStyle`) · **margin notes** (✎, rendered on cards with clickable `#tag` filter chips) · **keyboard-first toolbar** (Enter saves, ←/→ navigate) · **link preservation** in text clips · **right-click image capture** · **Privacy Ledger** (drawer avatar menu → 🔒 Privacy — a literal, honest account of what leaves the device) · **Trust Card** (auto-shown once, right after the first doc is added — "Your Doc is the real thing. SnipKeep is just how it got there.", with a real "Open your Doc" link) · **Link-Rot Insurance** (best-effort Wayback Machine snapshot at save time, written back into the Doc next to the caption once it exists; a 🏛 Archived link also appears on History cards) · **Living Resurface** (add a freshly dated note back into the Doc at any bookmarked clip's exact original spot, not just the Resurfaced one) · **Soft Triage** (an optional "Someday" tag + an occasional, zero-consequence "still relevant?" check-in — deliberately not Burn 451's delete-if-unread countdown). Notion code exists end-to-end (text + image) but is **hidden at MVP**.

Known gaps / follow-ups (intentional, not bugs to hunt blindly):
- **No `typecheck` script** — the build doesn't type-check (see Commands); adding `"typecheck": "tsc --noEmit"` and running it in CI/pre-build would stop errors slipping through.
- **Daily Resurface notification** — Resurface is in-drawer only; a `chrome.alarms`-driven daily nudge is the next step (see Living archive note).
- **Resurface is in-drawer only** — a daily *notification* (Readwise-style) is the natural next step; needs `chrome.alarms` + notification-click routing to open the drawer on that clip.
- The archive renders **capped at 50** rows (search to narrow) and stores at most `ARCHIVE_MAX` clips.

### Three isolated execution contexts

**Background** (`src/background/index.ts`) — MV3 service worker. All API calls (Google Docs; Notion code exists but is hidden at MVP), OAuth via `chrome.identity`, history, per-destination tracking, and **all `chrome.identity` work** (see gotcha below). Can be killed/restarted anytime — never rely on in-memory state; persist to `chrome.storage`.

**Content script** (`src/content/index.tsx`) — injected into every page except `docs.google.com`. Guarded against double-injection via `window.__snipkeepLoaded`. Renders the floating **Toolbar** on `mouseup` (250ms debounce), opens/closes the **Drawer** on `TOGGLE_DRAWER`, saves directly on `TRIGGER_SAVE` (Cmd/Ctrl+Shift+S) with a toast, drives the toolbar from page-level keys (see **Toolbar** below), extracts preserved links (`extractLinkSpans`), and handles `CAPTURE_IMAGE` (reads the right-clicked image's natural size + page title, then sends `SAVE_IMAGE`).

**Popup UI** (`src/popup/`) — React app (`Popup.tsx` + `popup.css`). Rendered primarily *inside the drawer*; `popup.html` is kept as a build entry but `default_popup` is removed so the icon fires `chrome.action.onClicked`. Two tabs: **Docs** (`DocsTab` — destination management, progressive-disclosure add form) and **History**. The History tab reveals two per-clip actions on hover/focus: **↗ Source** (`sourceHref` builds a Text Fragment `#:~:text=start,end` so the browser highlights the clip; images/empty → plain open) and **📄 Doc** (`docHref` → `docs.google.com/document/d/<destinationId>/edit`, hidden for legacy entries lacking the id or for Notion). These are plain `<a target="_blank">` links — the popup runs in the content-script context, so `chrome.tabs` is unavailable (same constraint as `chrome.identity`). A third action, **⧉ Cite**, builds a citation (`formatCitation` → APA/MLA/BibTeX) from the clip's metadata and copies it (`copyToClipboard`: `navigator.clipboard` with an `execCommand` textarea fallback; needs the `clipboardWrite` permission). The style is chosen once via the header toggle and persisted to `chrome.storage.sync` `citationStyle`. No author is captured, so `siteName(url)` (registrable-domain label) stands in as the group author and `savedAt` is the retrieval/accessed date. Cards also render the clip's **margin note** (`↳ …`) with any **`#tags`** as clickable chips (`renderNoteWithTags`) that set the search box to that tag — so tags filter the archive via the existing note-substring match (no separate tag index).

**Soft Triage** — `HistoryEntry.someday` is pure local archive metadata (`toggleSomeday`, no Docs call, no bookmark needed — works on every clip regardless of age, unlike the bookmark-gated features above). Someday clips are hidden from the main list **by default**; the header's `🕒 Someday (N)` toggle (`showSomedayOnly`) is the one-click way back to them — this is the actual point (fewer things in view), not just an optional filter nobody remembers to use. `pickResurfaced` excludes someday clips (already triaged once). `pickTriageCandidate(clips, excludeSavedAt)` occasionally surfaces a `triageCard` — pool is not-someday, not today's Resurfaced pick, saved >14 days ago (`TRIAGE_MIN_AGE_MS`), needs ≥3 candidates, same daily-deterministic-pick shape as `pickResurfaced` but offset (`+7`) so the two rarely coincide. All three of its actions — *Yes, still relevant* / *Mark as Someday* / *Not now* — do nothing more than record `triageDismissedDay` (a day-seed in `chrome.storage.local`) so it won't ask again today; **skipping has zero consequence**, deliberately the opposite of Burn 451's delete-if-unread mechanic. Styled calm on purpose — dashed border, no accent color — to read as optional, distinct from Resurfaced's violet "delight" treatment.

### `chrome.identity` is NOT available in content scripts (the #1 gotcha)

The drawer (and the Popup it renders) runs in the **content-script** context, where `chrome.identity` is `undefined`. Any identity/auth/Docs-token work from the drawer must be routed to the background via `chrome.runtime.sendMessage`. Handlers:
- `GET_USER_EMAIL` → avatar email (`getProfileUserInfo`)
- `GET_DOC_TITLE` → resolve a Doc's title (silent token + Docs API)
- `SIGN_IN` (gate screen) → interactive OAuth + cache email
- `SIGN_OUT` (drawer) → `removeCachedAuthToken` + clear `isSignedIn`/`userEmail`

Background auth helpers: `getAuthToken()` (interactive) and `getAuthTokenSilent()` (non-interactive, never prompts). Sign-out now works: `Drawer.handleSignOut` sends `SIGN_OUT` and optimistically clears the avatar; the `chrome.storage` change flips `isSignedIn` → the gate screen. (`SIGN_OUT` only drops Chrome's cached token, not the Google-side grant, so re-sign-in is a fast silent re-grant — no re-consent.)

The avatar dropdown also has a **🔒 Privacy** entry that switches `Drawer`'s `view` state (`'main' | 'privacy' | 'trust'`, mutually exclusive body content) to `<PrivacyLedger onBack={...} onShowTrust={...}/>` — a plain-language, honest restatement of the architecture above (no SnipKeep server; archive is device-local; settings sync via Chrome's own sync, not ours). It's a settings-like destination, not a third tab, since it isn't a browse-my-clips action.

`view === 'trust'` renders `<TrustCard firstDocId={...} onDismiss={...}/>` — "Your Doc is the real thing. SnipKeep is just how it got there," with a real link to the user's actual first Doc. It auto-shows exactly once (gated by `chrome.storage.sync.hasSeenTrustCard`), triggered the moment `docs.length` goes from 0 to ≥1 (either detected on drawer mount, for pre-existing users, or via the `'docs'` branch of the storage-change listener, ~1.1s after the doc is added while the drawer is open — the delay lets `DocsTab`'s own "added" flash register first). `trustShownRef` guards against the mount check and the listener both firing; the listener re-reads `hasSeenTrustCard` fresh from storage rather than trusting React state, avoiding a stale-closure bug (the listener closure is created once, at mount, in a `useEffect([])`). Reachable again anytime via Privacy Ledger's "Why your archive is safe →" link. Dismissing ("Got it") always returns to `'main'`, not back to wherever it was opened from — deliberately shallow, no back-stack.

### Toolbar (`src/content/Toolbar.tsx`)

The floating pill: `[Save to X] [✎] [···]`, in its own Shadow root (`#snipkeep-host`). Feedback states (`saving` / `saved` / `error`) replace the buttons in place. `showToolbar(rect, text, links)` in `content/index.tsx` captures `text` and `links` as a closure, so a save no longer depends on the live selection (arrow keys / focus changes that collapse it are harmless).

**Margin notes (✎).** The pencil toggles a note panel (textarea) below the pill. Enter = save-with-note, Shift+Enter = newline, Esc closes the panel (not the toolbar). The note is optional and rides in the `SAVE_NOTE` payload as `note`. `···` gets a matching `.active` background when its dropdown is open (parity with `.btn-note.active`).

**Keyboard control.** Once the toolbar is visible, `onGlobalKeyDown` (registered on `document` in **capture** phase) drives it via `toolbarApiRef.current.handleNavKey(key)`:
- **Enter** → save to the active destination (default highlight is Save).
- **←/→** → move the highlight across `Save → ✎ → ···`; Enter on ✎/··· opens that panel/menu.
- **Esc** → dismiss.
- Guards (all required): toolbar must be visible; bail if the *deep* target is editable (`isEditableTarget(deepTarget(e))` — `deepTarget` reads `composedPath()[0]` because a document listener retargets `e.target` to the shadow host); bail if the event originates inside the toolbar (its note field owns its own keys); ignore modifier combos and Enter key-repeat.
- `navActive` stays false until the first arrow, so mouse users never see a stuck highlight ring; `savingRef` is a synchronous re-entrancy guard against a double-Enter double-save.
- **Deliberately NOT done:** hijacking bare arrows to adjust the selection, or summoning the toolbar from a keyboard selection — both fight native text selection / caret browsing. The toolbar is summoned by `mouseup` only.

The end buttons carry the pill's 8px inner radius (`.toolbar > button:first-child`/`:last-child`) so the highlight's inset ring follows the corner instead of being clipped square by the toolbar's `overflow: hidden`.

### Drawer (Radix Sheet in Shadow DOM)

`src/content/Drawer.tsx` mounts the Popup as a right-side sheet built on `@radix-ui/react-dialog` (wrapped in `src/components/ui/sheet.tsx`). Key adaptations:
- **`modal={false}`** + `onInteractOutside` prevented + no overlay — SnipKeep is a *companion*: the page must stay scrollable/interactive, and the drawer stays open until closed via ✕ / Esc / icon toggle. (Modal mode locks body scroll + traps focus — wrong here.)
- Radix portals to `document.body` by default; `SheetContent` takes a `container` prop so the portal stays inside the Shadow DOM.
- Closing runs one path (`close()` in Drawer): set `open=false` to play the slide-out, then unmount after ~240ms. `closeRef` lets the content script trigger it.
- **Three `<style>` tags injected in order** (order = cascade): `POPUP_CSS` (popup.css `?inline`, with `:root`→`:host` and `body`→`.cn-popup-root`), then `SHEET_CSS` (exported from `sheet.tsx`), then `BODY_CSS` (drawer chrome: header/logo mark/avatar/footer — defined inline in Drawer.tsx).

### Fonts (bundled, not Google Fonts)

Plus Jakarta Sans is bundled at `public/fonts/plus-jakarta-sans.woff2` (one variable file, 400–800). External `@import` is blocked by strict page CSPs inside content scripts, so it's exposed via `web_accessible_resources` and loaded by `ensureFontLoaded()` (`src/lib/fonts.ts`), which injects the `@font-face` into **`document.head`** (NOT a shadow root — Chrome doesn't reliably apply shadow-scoped `@font-face`). Called from `content/index.tsx`, `Drawer.tsx`, and `popup/main.tsx`.

### Icon click → drawer (with inject-on-demand)

`chrome.action.onClicked` messages the tab with `TOGGLE_DRAWER`. Tabs opened *before* the extension loaded have no content script, so on failure the background injects `src/content/index.js` via `chrome.scripting.executeScript` and retries. On restricted pages (New Tab, `chrome://`, Web Store, PDF viewer) injection is impossible → a `chrome.notifications` message explains why.

### Message flow

```
Icon click   → background onClicked      → TOGGLE_DRAWER (+ inject-on-demand fallback) → content → Drawer
Cmd+Shift+S  → background commands       → TRIGGER_SAVE  → content (direct save + toast)
Save text    → content → SAVE_NOTE        → background → Google Docs API   (text, note, links)
Save image   → background contextMenus.onClicked → CAPTURE_IMAGE → content (read img size/title)
             → content → SAVE_IMAGE       → background → Google Docs API   (insertInlineImage)
Drawer auth  → content → GET_USER_EMAIL / GET_DOC_TITLE / SIGN_IN → background (chrome.identity)
```
All message types are in `src/types.ts`. The `SAVE_NOTE` payload carries optional `note` and `links: LinkSpan[]`; images use the separate `CAPTURE_IMAGE` (bg→content) / `SAVE_IMAGE` (content→bg) pair. Both the context menu and the icon click use the same inject-on-demand fallback for tabs opened before the extension loaded.

### Storage layout

| Store | Key | Value |
|---|---|---|
| `sync` | `docs` | `DocDestination[]` — destinations + `active` flag (toolbar visibility) |
| `sync` | `defaultDestId` | last used destination ID |
| `sync` | `isSignedIn` / `userEmail` | auth state + cached email for the avatar |
| `sync` | `notionConfig` | Notion token/page (hidden at MVP) |
| `local` | `clips` | `HistoryEntry[]` — the **full archive** (newest first, text sliced to 1000, capped at `ARCHIVE_MAX = 1000`). `addToArchive` seeds it from the legacy `history` the first time. Each entry carries optional `note` (rendered on cards, `#tags` clickable), `destinationId` (📄 Doc deep-link), `kind` (`'image'` → text `"🖼 Image"`). |
| `local` | `history` | **Legacy** last-10 store — only read now as the seed/fallback for `clips`; no longer written. |
| `local` | `docStats` | `Record<destId, {count, lastSavedAt}>` — drives the per-doc "Last clip … · N total" line; **must be `local`** to survive restarts |
| `local` | `lastSavedUrls` | `Record<destId, url>` — last-clip URL per dest; **`local`** so article grouping survives restarts (was `session`, which caused duplicate headings) |

Legacy `docId` (string, sync) is migrated to `docs: [{ id, name, active }]` on read in both background and content script.

### Google Docs formatting (`appendToGoogleDoc`)

Per save: GET the doc for its `endIndex`, then one `batchUpdate`. Clips from the **same article** (consecutive same URL per destination) group under **one heading**; a different URL starts a new block.

- **New article block:** `Heading 2` (page title) + caption `domain · date` (9pt grey, domain hyperlinked) + first clip as a bullet.
- **Continuation:** just another bullet.
- Spacing constants enforce hierarchy via proximity — `BLOCK_GAP_PT` (above a heading, separates blocks) ≫ `HEADING_BELOW_PT` / `CAPTION_BELOW_PT` / `BULLET_BELOW_PT`. `isFirstBlock` (insertionPoint ≤ 1) suppresses the lead-in gap on an empty doc.
- Clip text is **verbatim** (no summarizing/auto-formatting), except `normalizeSelectionText()` in `content/index.tsx`: single `\n` → space (visual wrap), `\n\n` → `\n` (real paragraph break → its own bullet).
- **Margin note** → `noteStyleRequests()`: the note is inserted as `↳ note`, an indented (italic, muted-violet `NOTE_FG`) line *after* the clip, in **both** branches. It's a plain paragraph, not a bullet — its range starts at `clipEnd`, so the clip's bullet range never overlaps it.
- **Preserved links** → `linkStyleRequests(clipStart, links)`: each `LinkSpan` (from `extractLinkSpans` in content) is styled as link + `LINK_FG` + underline, offset by `clipStart`. Content-side extraction locates each `<a>` text *inside the already-normalized clip* (doesn't rebuild the text), so the verbatim path is untouched; unfound anchors are skipped.

**Index math (the sharp edge):** every style/bullet/link request uses absolute indices computed from a **single** `insertText`. `createParagraphBullets` and `updateTextStyle`/`updateParagraphStyle` don't change the character count, so those absolute indices stay valid. Both JS `.length` and Docs indices are **UTF-16** units, so they align (incl. the `↳` glyph = 1 unit).

### Images (`appendImageToGoogleDoc`, `handleSaveImage`)

Right-click an image → context menu → `CAPTURE_IMAGE` → content reads `naturalWidth/Height` + title → `SAVE_IMAGE` → background inserts via `insertInlineImage`. Same article-grouping as text (heading+caption on a new article, bare image on a continuation).
- `fitImageSize(w, h)` scales natural px → PT (×0.75), capped at `MAX_W_PT = 468` (page content width), preserving aspect. Unknown dims → no `objectSize` (Docs default).
- The image request is pushed **last** in the batch so it doesn't shift the heading/caption style indices before it. New-article image index = `captionEnd` (the empty paragraph after the caption); continuation inserts a `\n` then places the image at `insertionPoint + 1`.
- **The URL must be public** http(s) and ≤ 2000 chars — Docs (and Notion) fetch it server-side. Content guards `data:`/`blob:` with a toast; `handleSaveImage` guards non-http/oversize. Login-gated images will fail server-side.

### Link-rot insurance (`archiveSnapshot`, `ensureArchived`)

Best-effort: a dead source page shouldn't kill the ↗ Source link forever. After a real save succeeds, `ensureArchived(url)` runs **fire-and-forget** (`.catch(() => {})`, not awaited) — it never blocks the save or delays the toast, and any failure (timeout, network error, archive.org declining) is silent.

- Keyed by the **source page URL**, in `chrome.storage.local.archivedUrls: Record<url, snapshotUrl>` — several clips from one article share one snapshot, and re-clipping that page weeks later into a different doc won't re-request it (`ensureArchived` checks the map first, and again right before writing, to survive two concurrent saves).
- `archiveSnapshot`: `GET https://web.archive.org/save/<url>` — free, no API key. `fetch` follows the redirect chain automatically, so `response.url` **is** the permanent snapshot address; no response parsing needed. 15s `AbortController` timeout.
- Requires the `https://web.archive.org/*` host permission (added to `manifest.json` — **needs a full reload**, same as any permission change).
- **Known gap:** if the MV3 service worker unloads before the fetch resolves, that one snapshot is silently skipped. Acceptable — it's a soft fallback, not core functionality, and the next clip retries for any still-unarchived page.
- UI: History's `archivedUrls` state loads once and stays live via a `storage.onChanged` listener, so the link can appear a few seconds after a save without reopening the drawer. `clipCard` shows **🏛 Archived** only when a snapshot exists for that entry's `sourceUrl` — never a promise upfront, never breaks today's ↗ Source behavior.
- Once a snapshot exists, `ensureArchived` also writes it **into the Doc itself** (see Doc bookmarks below) — the local `archivedUrls`/🏛-link UI is a convenience, not the source of truth; the Doc stays the durable copy, consistent with the whole Trust Card premise.

### Doc bookmarks (`NamedRange`) — the shared primitive behind link-rot write-back and Living Resurface

A `NamedRange` marks a position in a Google Doc that **Google keeps in sync automatically** as the surrounding document is edited — the reliable "remember an exact spot, come back and edit near it later" building block. Created via a `createNamedRange` request folded into the *same* `batchUpdate` that writes the clip (no extra round trip); its `namedRangeId` comes back in that response's `replies[]` array, which is **parallel to `requests[]`** — `appendToGoogleDoc`/`appendImageToGoogleDoc` track the index they pushed each `createNamedRange` request at (`bookmarkIdx` / `captionRangeIdx`) so they can pull the right reply back out. Both functions now **return** `{ clipNamedRangeId, captionNamedRangeId }` instead of `void`.

Two bookmarks get created:
- **Caption bookmark** — over `[captionStart, captionEnd-1]` ("domain · date"), created on every new-article save (text or image). Persisted in `chrome.storage.local.docCaptionBookmarks: Record<url, Record<destinationId, namedRangeId>>` (`saveCaptionBookmark`) — a page clipped into two different Docs gets an entry for each.
- **Clip-block bookmark** — over `[clipStart, end]`, where `end` is `note ? noteEnd-1 : clipEnd-1` (the whole block: bullet **plus its margin note, if one exists at save time** — so a later addition lands after both, not wedged in the middle). Created on **every** text-clip save (new-article or continuation). Stored directly on that `HistoryEntry.namedRangeId` — no separate lookup table needed. **Text clips only**; images don't get one (no "add a note" concept there today).

`resolveNamedRange(docId, token, namedRangeId)` — `GET .../documents/{id}?fields=namedRanges` (partial response, cheap), linear-searches every name-group for the matching ID, returns the **last** sub-range's `endIndex`. Returns `null` if not found (e.g. the user deleted that part of the doc) — every caller treats that as a normal, silent "skip," never an error surfaced to the user *except* in the one interactive path below.

**Two very different failure philosophies on top of the same primitive:**
- `appendArchiveLinkToDoc` (called from `ensureArchived` once a snapshot exists) — **silent best-effort**, matching the rest of link-rot insurance: uses `getAuthTokenSilent()` (no prompt), wrapped in try/catch, any failure just means no archive link this time.
- `handleAddDocNote` (behind `ADD_DOC_NOTE`, triggered by "+ Add a note" → "Add to Doc") — **interactive and real errors on purpose**. Available on **any clip with a bookmark**, not just the Resurfaced spotlight — the write-back mechanism never cared which card triggered it, so restricting it to Resurfaced was a UI choice, not a technical one, and got lifted. Uses `getAuthToken()` (may prompt) and throws a genuine `"Couldn't find that clip in the Doc anymore"` if the bookmark resolves to nothing, surfaced in the UI — this is a deliberate user action, not a background nicety, so silent failure would be the wrong call here. On success it also patches the matching local `clips` entry (matched by `savedAt === entrySavedAt`) so the History card shows the addition immediately, without waiting on a storage round-trip. In `Popup.tsx`, which card's note box is open is tracked by `noteOpenFor: number | null` (the clip's `savedAt`, a stable identity) — **not** by the render `key` string, since the same underlying clip can appear twice on screen (once as the Resurfaced spotlight, once again in the regular list below it) and both instances should share one open/closed state.

The dated note text (`(MMM D) your thought`) reuses the existing `noteStyleRequests` styling helper, and is appended to the entry's stored `note` joined by `\n` — `.history-note` has `white-space: pre-line` specifically so that renders as real line breaks instead of collapsing.

### Design system / visual hierarchy

Tokens live in `popup.css` `:root` — warm-near-black surfaces + one electric-violet accent (`--accent #8B7CF8`); text ramp `--text` / `--text-2` / `--text-3` is **WCAG-locked** (don't dim `--text-3` below `#948FA1` — it fails 4.5:1 on cards). Hierarchy is carried by a 4-tier type scale (logo 18 / doc-name 16-700 / tabs 15 / body 13 / micro 11) + weight + color together; accent reserved for ~4 tiny spots. Avoid one-off font-size bumps — they flatten the scale.

**Gotcha:** `Toolbar.tsx` and the toast (`content/index.tsx`) are separate Shadow DOM roots that **hardcode hex values** (no access to the CSS variables). When tokens change, update those by hand or they silently drift out of WCAG sync.

### Shadow DOM notes

Toolbar (`#snipkeep-host`) and drawer (`#snipkeep-drawer-host`) are Shadow roots. Use `e.composedPath()` (not `e.target`) to detect clicks from the outer document; CSS vars on `:host` are visible inside; host has `pointer-events: none` and the toolbar overflows it.
