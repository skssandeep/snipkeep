# Margin Notes

Let users attach an optional personal note ("your take") to a clip at save time.
Renders in the Google Doc as an indented italic sub-line under the clip.

## Design
- Toolbar gains a pencil toggle → expands a note panel (textarea) below the pill.
- Enter saves (with note); Shift+Enter = newline; Esc closes the panel (keeps toolbar).
- Fast path unchanged: clicking "Save to X" with no note open saves verbatim, no note.
- Keyboard quick-save (Cmd+Shift+S) stays note-free.
- In the Doc: note paragraph after the clip bullet — `↳ note`, italic, muted violet
  (signals "your voice" vs the verbatim quote), left-indented, snug spacing.

## Tasks
- [x] types.ts — add `note?: string` to SaveNoteMessage.payload + HistoryEntry
- [x] Toolbar.tsx — pencil toggle, note panel, Enter-to-save, thread note into onSave
- [x] content/index.tsx — pass note from toolbar onSave into SAVE_NOTE payload
- [x] background/index.ts — render note sub-line in appendToGoogleDoc (+ Notion parity, store in history)
- [x] build + verify identifiers/strings compiled

## Status: DONE (built, type-checks pass). Needs manual E2E in Chrome (OAuth + real Doc).
Note not yet surfaced in the drawer History UI — HistoryEntry stores it, but the
History tab doesn't render it yet. Follow-up if we want the note visible in-extension.

---

# Keyboard-first toolbar

Once the toolbar is visible (from a mouse selection), drive it from the keyboard.

## Design (scoped to avoid fighting native keys)
- Enter → save to the active destination (default highlight = Save).
- ←/→ → move a highlight across Save / ✎ note / ··· menu; Enter activates the highlighted one.
- Esc → dismiss the toolbar.
- Guards: only while toolbar visible; NEVER when focus is in an input/textarea/
  contenteditable; ignores events originating inside the toolbar (its note field
  handles its own keys); ignores modifier combos and Enter key-repeat.
- `↵` badge on the Save button teaches the shortcut; highlight ring only appears
  after the first arrow (no stuck-hover look for mouse users).
- Did NOT hijack bare arrows for selection or add keyboard-selection summon —
  deliberately out of scope (fights native text selection / caret browsing).

## Tasks
- [x] types.ts — ToolbarApi { handleNavKey }
- [x] content/index.tsx — deepTarget/isEditableTarget guards, global capture keydown, apiRef wiring
- [x] Toolbar.tsx — highlight/navActive state, handleNavKey, kbd-focus ring, ↵ badge, re-entrancy guard
- [x] build + verify compiled
- Needs manual E2E in Chrome.

---

# Links + inline images

Clips stop being flat text: hyperlinks survive, and images can be saved.

## A. Inline images (right-click → Save image to SnipKeep)
- manifest: add `contextMenus` permission.
- background: create context menu (contexts:['image']); onClicked → message tab
  CAPTURE_IMAGE (inject-on-demand fallback like the icon click).
- content: CAPTURE_IMAGE → read img natural dims + page title, pick default dest,
  send SAVE_IMAGE, toast the result. Guard data:/blob: URLs.
- background: SAVE_IMAGE → appendImageToGoogleDoc (insertInlineImage, scaled objectSize)
  / Notion external image block. Groups under same-article heading. History = "🖼 Image".

## B. Link preservation (selected text)
- content: extractLinkSpans(range, normalizedText) — find each <a> text inside the
  normalized clip, record {start,end,url}. Low-risk: doesn't touch the text path.
- pass `links` in SAVE_NOTE payload (toolbar + quick-save).
- background: apply link + colour + underline over each span, offset by clipStart,
  in both new-article and continuation branches.

## Tasks
- [x] types.ts — LinkSpan, links on SaveNoteMessage, CaptureImage/SaveImage messages
- [x] manifest.json — contextMenus permission
- [x] background — context menu, SAVE_IMAGE handler, appendImage*, link styling, fitImageSize
- [x] content — CAPTURE_IMAGE handler, extractLinkSpans, thread links through saves
- [x] build + verify (tsc: no new errors; only pre-existing @types/chrome getAuthToken ones remain)
- Also fixed pre-existing legacy-doc migration missing `active` (same pattern I wrote in handleSaveImage).

## Status: DONE (built). Needs FULL extension reload (manifest permission changed) + manual E2E.
Known limits: image must be a public URL (login-gated / data: / blob: → graceful error);
Docs fetches it server-side. Notion image parity added but Notion still hidden at MVP.
Pre-existing (out of scope): tsc errors on getAuthToken (@types/chrome version), popup.css?inline,
unused React import — project bundles via esbuild which ignores these.

---

# History navigation (two per-clip actions)

Each history card reveals two actions on hover/focus:
- **↗ Source** — opens the source URL with a Text Fragment (`#:~:text=start,end`) so
  Chrome scrolls to + highlights the clip. Images / empty → plain open.
- **📄 Doc** — opens the Google Doc (`docs.google.com/document/d/<id>/edit`). Hidden
  when destinationId is missing (legacy entries) or is 'notion'.

## Tasks
- [x] types.ts — HistoryEntry: destinationId?, kind?
- [x] background — write destinationId (both saves) + kind:'image' (image save)
- [x] Popup.tsx — buildTextFragment / sourceHref / docHref, card → div + two hover actions
- [x] popup.css — .history-actions (opacity reveal, no layout jump), .hist-action, focus ring
- [x] tsc clean (only pre-existing errors) + build

Deferred (per critique): deep-link to the exact clip INSIDE the Doc (needs bookmark-at-save-time).
Reliability caveat: Text Fragments can miss on dynamic/changed pages → degrades to plain open.
Only NEW clips get destinationId; older history entries show Source only.

---

# Auto-citation (copy to clipboard)

Turn a clip's captured metadata (title, url, date, site) into a formatted citation.

## Design
- One "Cite as" toggle in the History header: APA / MLA / BibTeX; persisted to
  chrome.storage.sync (`citationStyle`, default apa). Pick once, applies to all.
- Each card gets a ⧉ Cite button (in the hover actions row) → builds the citation
  in the chosen style → copies → button shows "Copied ✓" for ~1.2s.
- No author is captured → use the site name (registrable domain label) as the
  group author; save date used as the retrieval/accessed date.
- Clipboard: navigator.clipboard.writeText with an execCommand textarea fallback
  (popup runs in content-script context). Add `clipboardWrite` permission.

## Tasks
- [x] manifest.json — clipboardWrite permission (FULL reload needed)
- [x] Popup.tsx — CitationStyle, siteName, formatCitation, copyToClipboard, style toggle, Cite button + feedback
- [x] popup.css — cite-style selector + states
- [x] tsc (only pre-existing errors) + build

## Status: DONE. Needs FULL reload (clipboardWrite permission). Works for text + image clips.
Limits: no author captured → site name used as group author; save date = retrieval/accessed date.
siteName heuristic (2nd-level domain label) misses on ccTLDs like example.co.uk.
Fix: clipboard copy was stale on Google Docs (navigator.clipboard fails when page owns
focus) → switched to textarea+execCommand first; button now shows Copied ✓ / Copy failed.

---

# Living archive + Resurface

Lift the 10-clip ceiling: keep every clip, search them, resurface an old one.

## Design
- New store `clips` (chrome.storage.local): ALL clips, newest first, full-ish text
  (slice 1000), capped at 1000 to bound storage (no unlimitedStorage → no manifest change).
  `addToArchive` seeds `clips` from the legacy `history` the first time.
- History tab reads `clips` (fallback `history`); search box filters text/title/dest/note;
  list capped at 50 rendered with a "showing first 50 of N" note.
- Resurface: `pickResurfaced` deterministically picks one clip per day (prefers clips
  >1 day old); shown as a ✨ Resurfaced spotlight card above the list (hidden while searching).
- Clear all now clears `clips` + `history`.

## Tasks
- [x] background — addToArchive (clips store, cap 1000, seed from history); text slice 1000; renamed call sites
- [x] Popup.tsx — read clips (fallback history), search, pickResurfaced, clipCard() helper, feedback keyed by string
- [x] popup.css — search input, resurface label + card
- [x] tsc (no new errors) + build

## Status: DONE. No manifest change → plain reload. Archive seeds from old history on first save.
Deferred: daily resurface NOTIFICATION (needs chrome.alarms + notification click routing).
List rendered capped at 50 (search to narrow); archive capped at 1000 (bounds storage < 10MB).

---

# Polish pass + Tags

## A. Fix dead sign-out (bug)
- Root cause: Drawer.handleSignOut called chrome.identity directly → undefined in
  content-script context → threw, cleared nothing.
- Fix: types SignOutMessage/Response; background SIGN_OUT handler (removeCachedAuthToken
  + clear isSignedIn/userEmail); Drawer sends SIGN_OUT + optimistic avatar clear;
  storage change flips gate. (Drops cached token only, not Google-side grant.)

## B. Show margin notes on cards + Tags
- clipCard renders `↳ note` (was stored, never shown).
- renderNoteWithTags: #tags in the note become clickable chips → set search to `#tag`
  → filters via existing note-substring match (no separate tag index).

## Tasks
- [x] types.ts — SignOutMessage/Response
- [x] background — SIGN_OUT handler
- [x] Drawer.tsx — route handleSignOut through SIGN_OUT
- [x] Popup.tsx — renderNoteWithTags, render note line, tag click → setQuery
- [x] popup.css — .history-note, .note-tag
- [x] tsc (no new errors; React-unused now resolved) + build

## Status: DONE. No manifest change → plain reload.

---

# Privacy Ledger (research report feature #1)

A literal, honest account of what leaves the device — restates the true
architecture (no SnipKeep server; Docs API direct with the user's own OAuth;
archive local-only; settings sync via Chrome's own sync) as visible trust UI.

## Design
- Reached from the drawer avatar menu → "🔒 Privacy" (new item above Sign out).
- Replaces <Popup/> in the drawer body (not a third tab — this isn't a
  browse-my-clips action, it's an account-area/settings-like destination).
  Back arrow returns to the normal Docs/History view.
- 4 items (3 ✓ green-violet, 1 ✕ red "no SnipKeep server"), a closing line,
  and an "Open Google Docs ↗" link.

## Tasks
- [x] Popup.tsx — PRIVACY_ITEMS data + PrivacyLedger component (exported)
- [x] popup.css — .privacy-* styles + focus-visible ring entries
- [x] Drawer.tsx — showPrivacy state, avatar-menu entry, swap body, hide footer hint while shown
- [x] tsc (no new errors) + build

## Status: DONE. No manifest change → plain reload.

---

# Trust Card (research report feature #2)

"Your Doc is the real thing. SnipKeep is just how it got there." — shown once,
automatically, right after the FIRST destination doc is added (not at bare
sign-in — deliberately deferred from the original plan since there's no real
doc yet to point the "Open your Doc" button at immediately after sign-in).

## Design
- Gate: chrome.storage.sync `hasSeenTrustCard` (bool). Shows when docs.length>=1
  && !hasSeenTrustCard: (a) on drawer mount, for existing users who already had
  docs before this shipped, or (b) ~1.1s after the first doc is added while the
  drawer is open (delay lets DocsTab's own "added" flash register first).
- `trustShownRef` guards against double-trigger between the mount check and the
  storage-listener check. The listener re-reads hasSeenTrustCard fresh from
  storage (not React state) to dodge the closure-captures-stale-value trap.
- Drawer owns a `view: 'main'|'privacy'|'trust'` state (replaced the old
  showPrivacy boolean) so Popup/PrivacyLedger/TrustCard are mutually exclusive
  in the body. Reachable again anytime from Privacy Ledger → "Why your archive
  is safe →".
- "Open your Doc right now" links straight to the first configured doc
  (docs.google.com/document/d/<id>/edit); falls back to generic Google Docs
  home if none (only reachable via the manual Privacy link in that case).
- "Got it" → sets hasSeenTrustCard + returns to 'main' (not back to wherever it
  was opened from — kept shallow/predictable rather than a back-stack).

## Tasks
- [x] Popup.tsx — googleDocUrl helper, TrustCard component, PrivacyLedger gains onShowTrust link
- [x] popup.css — .trust-* + .privacy-trust-link styles, focus-visible entries
- [x] Drawer.tsx — view state machine (replacing showPrivacy), auto-trigger effect + listener, handleDismissTrust
- [x] tsc (no new errors) + build

## Status: DONE. No manifest change → plain reload.

---

# Link-Rot Insurance (research report feature #3)

Best-effort Wayback Machine snapshot at save time, so a card can offer an
"🏛 Archived" link that still works even if the live source page dies later.

## Design
- Keyed by source PAGE url (not per-clip, not per-destination) in a new
  `chrome.storage.local.archivedUrls: Record<url, snapshotUrl>` — several clips
  from one article share a single snapshot; re-clipping that page weeks later
  into a different doc won't re-request one either (`ensureArchived` checks the
  map first).
- `archiveSnapshot(url)`: GET `https://web.archive.org/save/<url>` (free, no
  API key). fetch follows the redirect chain automatically; `response.url` IS
  the permanent snapshot address. 15s AbortController timeout. Any failure
  (timeout, network error, non-2xx, archive.org declining) → return null,
  silently skip — never blocks or delays the real save.
- Called fire-and-forget (`ensureArchived(url).catch(() => {})`, NOT awaited)
  right after `setLastSavedUrl` in both `handleSave` and `handleSaveImage` —
  runs after the toast, invisible to the user. Known limitation: if the service
  worker unloads before this resolves, that one snapshot is silently skipped;
  low-stakes since it's a soft fallback, not core functionality.
- `ensureArchived` re-reads the map right before writing (not just at the start)
  to avoid two concurrent saves clobbering each other's writes.
- UI: History's `archivedUrls` state loads once + stays live via a
  `storage.onChanged` listener (so the link can appear a few seconds after a
  save without reopening the drawer). `clipCard` shows "🏛 Archived" only when
  `archivedUrls[entry.sourceUrl]` exists — right between ↗ Source and 📄 Doc.
- manifest.json — added `https://web.archive.org/*` to host_permissions.

## Tasks
- [x] manifest.json — host_permissions for web.archive.org (FULL reload needed)
- [x] background — archiveSnapshot, ensureArchived, wired into both save handlers
- [x] Popup.tsx — archivedUrls state + live listener, 🏛 Archived hover-action
- [x] tsc (no new errors) + build; verified compiled logic in both bundles

## Status: DONE. Needs FULL extension reload (new host permission).
Not yet verified end-to-end against a real archive.org request (needs a live
save + a few seconds' wait) — logic and error handling were traced, not run live.

## Follow-up: archive-link write-back + Living Resurface (feature #8), same session
The gap flagged after shipping the above: the "🏛 Archived" link only lived in
SnipKeep's local storage, not the Doc — so it wouldn't survive SnipKeep itself
disappearing (undercutting the whole Trust Card premise). Fixed by building a
shared Google Docs bookmark primitive (NamedRange) and using it for both this
feature and Living Resurface, since both need "remember an exact spot in the
Doc, come back and edit near it later."

### Shared primitive
- `appendToGoogleDoc`/`appendImageToGoogleDoc` now ALSO push `createNamedRange`
  requests: one over the caption ("domain · date") on every new-article save,
  one over the whole clip block (bullet + its margin note, if any — computed as
  `note ? noteEnd-1 : clipEnd-1`, so a later addition lands after both, not
  wedged in the middle) on EVERY text-clip save. Reply indices are tracked
  (`bookmarkIdx`/`captionRangeIdx`) since batchUpdate's `replies[]` is parallel
  to `requests[]`; both functions now return the resulting namedRangeIds
  instead of void.
- `resolveNamedRange(docId, token, namedRangeId)` — `GET ?fields=namedRanges`,
  linear search across all name-groups for the matching ID, returns the last
  sub-range's endIndex. Returns null if not found (e.g. user deleted that part
  of the doc) — every caller treats that as a normal, silent "skip."

### Archive-link write-back (closes the #3 gap)
- New store `docCaptionBookmarks: Record<url, Record<destinationId, namedRangeId>>`
  (`saveCaptionBookmark`), written whenever `isNewArticle && captionNamedRangeId`.
- `ensureArchived`, after storing a snapshot, now also looks up every doc
  bookmarked for that URL and calls `appendArchiveLinkToDoc` for each — a
  second best-effort batchUpdate that inserts " · archived" (hyperlinked, 9pt,
  matching caption style) right after the caption. Silent on any failure
  (no cached token, range not found, request fails) — same philosophy as the
  rest of this feature.

### Living Resurface (feature #8)
- `HistoryEntry.namedRangeId` — the clip-block bookmark, stored on save (text
  clips only; images are scoped out, no "add a note" concept there today).
- **Generalized after initial ship** (same session, per user request): "+ Add a
  note" appears on **any card with a bookmark**, not just the Resurfaced
  spotlight — the write-back mechanism never distinguished them; restricting it
  to Resurfaced was a UI choice with no technical basis, so it got lifted.
  Renamed throughout for honesty: `ADD_RESURFACE_NOTE`→`ADD_DOC_NOTE`,
  `AddResurfaceNoteMessage/Response`→`AddDocNoteMessage/Response`,
  `handleAddResurfaceNote`→`handleAddDocNote`, `.resurface-note-*`→`.doc-note-*`.
- Popup.tsx state reworked from a single shared "is it open" boolean (only
  ever valid for one spotlight card) to `noteOpenFor: number | null` keyed by
  `entry.savedAt` — a stable clip identity, NOT the render `key` string (the
  resurfaced pick and its duplicate in the regular list below share one key
  space: `'resurface'` vs `${savedAt}-${i}` — using `savedAt` means both
  instances of the same underlying clip share one open/closed state correctly).
- `ADD_DOC_NOTE` (background): resolves the bookmark, inserts a freshly
  dated `↳ (MMM D) ...` line right after it (reusing `noteStyleRequests`),
  THEN patches the matching local `clips` entry's `.note` (matched by
  `savedAt === entrySavedAt`) so the History card reflects it immediately.
  Uses the INTERACTIVE token (`getAuthToken()`), not silent — this is a direct
  user action, so a real error ("couldn't find that clip anymore") is correct
  here, unlike the silent-everywhere archive-link path.
- `.history-note` gained `white-space: pre-line` so the growing, newline-joined
  note (original + each dated addition) actually breaks visually instead of
  collapsing into one run.

## Tasks
- [x] types.ts — HistoryEntry.namedRangeId, AddDocNoteMessage/Response
- [x] background — createNamedRange wiring in both Google Docs append fns;
      resolveNamedRange; appendArchiveLinkToDoc; saveCaptionBookmark;
      handleAddDocNote + ADD_DOC_NOTE listener; handleSave/
      handleSaveImage updated to capture + persist bookmark IDs
- [x] Popup.tsx — noteOpenFor/noteDraft/noteStatus (keyed by savedAt), "+ Add a
      note" available on any bookmarked card, optimistic local note update
- [x] popup.css — .doc-note-* styles, white-space:pre-line, focus rings
- [x] tsc (no new errors) + build; verified compiled logic in both bundles; no
      stale references to the old resurface-specific names left anywhere

---

# Soft Triage (research report feature #4)

The calm alternative to Burn 451's delete-if-unread countdown: an optional
"Someday" tag plus an occasional, zero-consequence "still relevant?" check-in.
Nothing is ever deleted or hidden without the user's own action.

## Design
- `HistoryEntry.someday?: boolean` — purely local archive metadata, does NOT
  touch the Doc, so no background round-trip or bookmark needed; works on
  every clip regardless of age (unlike Living Resurface's namedRangeId gate).
- Someday clips are hidden from the main list BY DEFAULT (the actual point —
  fewer things in view — not just an optional filter), with a header toggle
  "🕒 Someday (N)" as the one-click escape hatch back to them. `showSomedayOnly`
  state flips which half of `entries` becomes the filterable base.
- `pickResurfaced` now excludes someday clips (already triaged once, shouldn't
  also get the "look what you saved!" delight treatment).
- `pickTriageCandidate(clips, excludeSavedAt)`: pool = not-someday, not
  today's Resurfaced pick, saved >14 days ago (`TRIAGE_MIN_AGE_MS`); needs
  >=3 candidates; daily deterministic pick like Resurfaced but offset (+7)
  so the two rarely coincide even at equal pool sizes.
- Shown at most once/day: `triageDismissedDay` (chrome.storage.local, a
  DAY_MS day-seed) is set by ANY of the three actions — Yes/Someday/Not now —
  all three just mean "don't ask again today," none delete anything.
- Visually deliberately calm/muted (dashed border, no accent color) —
  differentiated from Resurfaced's violet "delight" styling on purpose, so it
  reads as optional/no-big-deal rather than another urgent thing to deal with.
- Per-card persistent "🕒 Someday" toggle also added to every clipCard's action
  row (independent of the occasional check-in) for direct manual control.

## Tasks
- [x] types.ts — HistoryEntry.someday
- [x] Popup.tsx — pickTriageCandidate, toggleSomeday, dismissTriageForToday,
      triageCard, someday filter state + header toggle, updated empty-states,
      per-card Someday toggle button
- [x] popup.css — .hist-action.active, .someday-filter(.active),
      .history-header-actions, .triage-* (calm/dashed, no accent), focus rings
- [x] tsc (no new errors) + build; verified compiled logic in bundle

## Status: DONE. No manifest change → plain reload. Purely local storage —
no Google Docs API calls, no new permission, works instantly on clips of any age.

## Status: DONE. No NEW manifest change beyond the already-added web.archive.org
permission. Needs a live end-to-end test (save → wait for archive → confirm the
Doc gets the follow-up link; resurface a clip → add a note → confirm the Doc
gets the dated line) — traced carefully but not run against real Docs/archive.org.
Known limitation: Notion destinations get neither bookmark (no NamedRange
equivalent wired) — archive-link and Living Resurface are Google-Docs-only,
consistent with Notion being hidden at MVP anyway.

---

# Gentle Reflection Nudge (research report feature #5)

Targets the collector's fallacy at the exact moment it's happening: reading
one article and highlighting quote after quote without ever writing a
reaction. A soft, dismissable one-liner, not a popup or a scold.

## Design
- `pickReflectionNudge(clips)`: walks the newest-first archive from the front,
  counting a streak of consecutive clips sharing the SAME `sourceUrl` with no
  `.note` — breaks on the first clip from a different page or with a note.
  Fires at `REFLECTION_NUDGE_THRESHOLD = 5`.
- Purely local/client-side, like Soft Triage — no background call, no schema
  change to HistoryEntry (reads existing `sourceUrl`/`note` fields only).
- Dismissal (`reflectionNudgeDismissed: {url, count}` in chrome.storage.local)
  is keyed by streak LENGTH, not just URL: dismissing a 5-clip streak
  suppresses it, but if the SAME article's streak grows to 8, it resurfaces —
  the pattern intensifying is worth a second nudge, an unchanged streak isn't.
- "Look back" sets the search box to the article's title (reuses the existing
  sourceTitle substring search — no new filter plumbing). "Dismiss" just
  records the dismissal; ignoring it entirely does the same thing.
- Suppressed while searching or in Someday-only view, same as Resurfaced/Triage.
- Rendered between Resurfaced and Triage (delight → in-the-moment nudge →
  old-stuff check-in), styled as the lightest-weight of the three: no card
  box, no border, just an inline line — a suggestion, not a decision.

## Tasks
- [x] Popup.tsx — pickReflectionNudge, reflectionDismissed state + load,
      dismissReflectionNudge, suppression logic (q/someday/dismissed-streak),
      render between Resurfaced and Triage
- [x] popup.css — .reflection-nudge* (deliberately borderless/minimal), focus rings
- [x] tsc (no new errors) + build; verified compiled into bundle

## Status: DONE. No manifest change → plain reload. Purely local storage —
same low-risk shape as Soft Triage, no Docs API involvement.

---

# Deadline-Aware Citations (research report feature #6)

Ties the already-shipped citation feature to a real, concrete deadline. Design
approved via an HTML mockup (research/ — not committed, scratchpad only)
recreating the actual Docs tab before building.

## Design
- `DocDestination.dueDate?: string` (ISO YYYY-MM-DD) — purely local metadata on
  the destination, like Someday; never touches the Doc.
- `HistoryEntry.cited?: boolean` — set once "⧉ Cite" successfully copies a
  citation (in `handleCite`, gated on copy success). One-way ratchet: the
  button becomes "✓ Cited" (active style, mirrors Someday's toggle look) but
  re-clicking just re-copies, it doesn't un-cite.
- `deadlineStatus(dueDate, uncited)`: daysLeft via `Math.ceil((due - now)/DAY_MS)`
  with due-date treated as end-of-day (`T23:59:59`) so "due today" doesn't
  read as overdue at 9am. Three tiers: calm (>7d), warn (3-7d), danger (≤2d,
  today, or overdue) — escalates the SAME status line's color, doesn't add a
  new element.
- DocsTab: "+ Set a deadline" (hidden once set) → a custom calendar popup (see
  follow-up below — replaced the native date input before shipping).
  `.doc-item` restructured from a single flex row to column layout
  (`.doc-item-top` holds the original row) so the deadline-row can sit below it.
- Uncited count: DocsTab now also loads `clips`/`history` (previously only
  `docStats`), computing `Record<destinationId, count>` via `computeUncited`,
  kept live via the existing `storage.onChanged` listener (extended to also
  watch `changes.clips`).
- "Cite them →" (danger tier only, and only if uncited > 0): a nested `<span
  onClick stopPropagation>` inside the status `<button>` — stopPropagation so
  clicking it doesn't also trigger the outer button's "edit deadline" handler.
  Calls `onJumpToHistory(doc.name)`, lifted through `Popup()` root (DocsTab and
  History are siblings, neither can reach the other directly) as
  `historyFilter` state → `History`'s `initialFilter` prop, consumed via a
  `useEffect` that sets the search query then clears the shared state (so
  revisiting History later doesn't reapply a stale filter).
- New CSS token `--warn` (amber) alongside the existing `--danger` — semantic
  escalation colors, kept separate from the violet `--accent`.

## Tasks
- [x] types.ts — DocDestination.dueDate, HistoryEntry.cited
- [x] Popup.tsx — deadlineStatus, DocsTab: uncitedCounts/computeUncited,
      editingDeadlineFor + selectDeadline/clearDeadline, doc-item-top
      restructure, deadline-row render; History: handleCite marks cited +
      button shows "✓ Cited", initialFilter/onFilterConsumed props + effect;
      Popup root: historyFilter lift + wiring
- [x] popup.css — --warn token, .doc-item column restructure, .deadline-row,
      .set-deadline-link, .deadline-status(.calm/.warn/.danger),
      .deadline-status-text, .severity-dot, .cite-jump, focus rings
- [x] tsc (no new errors, verified with local ./node_modules/.bin/tsc after an
      npx registry-resolution flake) + build; verified compiled into bundle

## Status: DONE. No manifest change → plain reload. Not yet manually
click-tested in the live extension (mockup was visually verified; the real
component wiring was traced carefully but not driven in Chrome).

## Follow-up: native date input → custom calendar popup (same session)
The native `<input type="date">` was correctly flagged as wrong before this
ever shipped: it's OS-rendered and impossible to theme, so it would have
clashed hard with SnipKeep's dark violet UI. Replaced with a custom calendar,
built to match the design system exactly, and visually verified against the
real `popup.css` (not a recreation) before considering this done.

- `toISODate(d)` formats using **local** year/month/day — deliberately not
  `toISOString()`, which reads UTC and can silently shift the stored date by a
  day depending on the user's timezone. This must agree with `deadlineStatus`,
  which already compares against local "today."
- `getMonthGrid(year, month)` builds the 7-wide cell array (leading `null`s for
  the offset before day 1); `DeadlineCalendar` owns `viewYear`/`viewMonth` nav
  state, independent of the selected value.
- Commits **immediately on click** — no separate Set button. Picking a date
  calls `onSelect` (→ `selectDeadline`) and the popup closes right away.
  Dates before today are disabled (can't set the past as a new deadline).
  "Remove deadline" only shows once a date exists.
- Dismiss-on-outside-click via `composedPath()` + a ref, same pattern already
  used for the Drawer's avatar dropdown and the Toolbar's destination menu.
- `.cal-popup` is `position: absolute` anchored to `.deadline-row` (now
  `position: relative`) — floats over the list rather than pushing cards below
  it down, same technique as the toolbar/avatar dropdowns.
- Visually verified: copied the REAL `popup.css` (not a recreation) into a
  static HTML harness with the real font, screenshotted via headless Chrome —
  confirmed grid alignment, selected/today color treatment, and the floating
  shadow all render correctly before calling this done.

---

# Assignment/Project Mode (research report feature #7)

Every other tool in this category models the archive as one infinite,
undifferentiated pile. This lets a piece of it actually be finished: a Doc
can be marked "done," moving it out of the active list without deleting it,
and out of the proactive pickers (Resurfaced/Triage/Reflection) that would
otherwise keep surfacing a project you've already turned in.

## Design
- `DocDestination.done?: boolean` — same shape as `active`/`dueDate`: local
  sync metadata, never touches the Doc. **Deliberately independent of
  `active`** — marking done doesn't silently flip toolbar visibility, and
  reopening doesn't silently restore it. No hidden side effects either way.
- DocsTab splits `docs` into `activeDocs`/`completedDocs`. Active docs gain a
  third icon button (`✓` next to the existing toggle/remove) to mark done.
  Completed docs render in a separate, **collapsed-by-default** section
  (`showCompleted`, same UX pattern as History's Someday filter) behind a
  "▸ Completed (N)" toggle — muted styling (opacity), simplified card (no
  toggle switch, no deadline row — a finished project doesn't need either),
  just name/meta + "↩ Reopen" + remove.
- `History` now also loads `docs` (previously only DocsTab did) to build
  `doneDestIds: Set<string>`, live via the same `storage.onChanged` handler
  (checks `'docs' in changes` — safe without an area filter since `docs` only
  ever lives in `sync`). Before calling `pickResurfaced`/`pickTriageCandidate`/
  `pickReflectionNudge`, entries are filtered to `activeEntries` (excludes
  clips whose `destinationId` is done) — **the main searchable list is
  untouched**, so old work from a finished project is still findable/citable,
  only the proactive "hey, look at this" prompts stop firing for it.

## Tasks
- [x] types.ts — DocDestination.done
- [x] Popup.tsx — DocsTab: toggleDone, showCompleted, activeDocs/completedDocs
      split, ✓ button + Completed section render; History: doneDestIds state +
      load + live listener, activeEntries filter feeding the three pickers
- [x] popup.css — .btn-done, .completed-section/.completed-toggle,
      .doc-item.done, .btn-reopen, focus rings
- [x] tsc (no new errors) + build; verified compiled into bundle; visually
      verified against the real popup.css (doc-item-top's 3rd button doesn't
      overflow at 340px; completed section reads clearly de-emphasized)

## Status: DONE. No manifest change → plain reload. Not yet manually
click-tested in the live extension.

## Follow-up: collapsed section → dedicated "Completed" tab (same session)
User explicitly asked to promote Completed from a collapsed section (inside
Docs) to a third top-level tab, after hearing the critique first (Hick's Law —
a third tab is a permanent cost for rarely-used content; breaks the pattern
just established for History's Someday filter; risked cramping the 340px tab
bar; "Docs" would need a less-accurate rename to something like "Active").
User decided the dedicated tab was worth it anyway — built as instructed.

- `Tab` type: `'docs' | 'completed' | 'history'`. Third `<button className="tab">`
  added to the bar; visually verified at real 340px width with the real font —
  fits with room to spare (`Docs` + `Completed` + `History` well under the
  available ~304px after container padding).
- `DocsTab` simplified back to active-only (`docs.filter(d => !d.done)`) — the
  whole `.completed-section`/`showCompleted` collapsed-disclosure UI was
  removed entirely (dead code once the tab exists; a doc living in two places
  would be confusing). Its "✓" button renamed `toggleDone` → `markDone`
  (one-directional now — DocsTab only ever marks *toward* done, since a
  completed doc no longer appears in its own list) and now shows a flash
  ("Marked as done — see the Completed tab.") instead of silently vanishing —
  mitigates the "jarring, no feedback" risk flagged in the original critique
  without forcing an auto-tab-switch (which would interrupt whatever the user
  was mid-doing in Docs).
- New sibling component `CompletedTab` — loads its own `docs`/`docStats`
  (DocsTab and CompletedTab can't reach into each other's state; each tab
  fully unmounts when you switch away, so no cross-component sync is needed
  beyond each independently listening to `storage.onChanged`). Renders
  "↩ Reopen" (flips `done: false`, flash: "Reopened — see the Docs tab.") and
  "✕ Remove" per completed doc; a full empty state ("No completed projects
  yet") when there are none, matching History's empty-state pattern.
- CSS: removed `.completed-section`/`.completed-toggle` (dead — no more
  in-place disclosure); kept `.doc-item.done`/`.btn-reopen` (still used, now
  by `CompletedTab` instead of DocsTab's old inline section).

## Design audit pass (colors / spacing / tab switching)

Confirmed by reading the real CSS:
- **Color drift:** `.cite-opt.active` on OLD accent `rgba(139,124,248,.12)` (#8B7CF8)
  while every other active pill uses current `rgba(169,156,255,.12)` (#A99CFF).
  `.history-item.resurfaced` + `.history-note` (#a99cff literal) also off-token.
  → introduce `--accent-soft`, fix drift, tokenize. CLAUDE.md still says #8B7CF8.
- **Spacing:** no scale; History double-spaces (tab-content gap:22 + child
  margin-bottoms 10/10/12/14 → 32–34px real gaps). Add 4px token scale; group
  History top controls tightly (proximity), drop additive margins.
- **Tab switching:** instant swap, no motion → keyed entrance animation.
Verify: tsc + build + real-CSS headless screenshots (Docs, History, switch).
