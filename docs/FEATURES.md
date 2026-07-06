# SnipKeep — Feature Deep-Dives

Detailed mechanics for the features built from `research/SnipKeep-Competitive-Psychology-Report.pdf`'s 11-feature roadmap, plus the two pre-roadmap capture features (margin notes, keyboard toolbar) that predate the report. Kept separate from `CLAUDE.md` so that file stays a fast architectural reference — come here when you're touching one of these specific features and need the "why," not just the "what."

See `docs/ROADMAP.md` for shipped/remaining status and priority order.

---

## Privacy Ledger (report #1)

The avatar dropdown has a **🔒 Privacy** entry that switches `Drawer`'s `view` state (`'main' | 'privacy' | 'trust'`, mutually exclusive body content) to `<PrivacyLedger onBack={...} onShowTrust={...}/>` — a plain-language, honest restatement of the real architecture (no SnipKeep server; archive is device-local; settings sync via Chrome's own sync, not ours). It's a settings-like destination, not a tab, since it isn't a browse-my-clips action.

## Trust Card (report #2)

`view === 'trust'` renders `<TrustCard firstDocId={...} onDismiss={...}/>` — "Your Doc is the real thing. SnipKeep is just how it got there," with a real link to the user's actual first Doc. Auto-shows exactly once (gated by `chrome.storage.sync.hasSeenTrustCard`), triggered the moment `docs.length` goes from 0 to ≥1 (either detected on drawer mount for pre-existing users, or via the `'docs'` branch of the storage-change listener, ~1.1s after the doc is added while the drawer is open — the delay lets `DocsTab`'s own "added" flash register first). `trustShownRef` guards against the mount check and the listener both firing; the listener re-reads `hasSeenTrustCard` fresh from storage rather than trusting React state, avoiding a stale-closure bug (the listener closure is created once, at mount, in a `useEffect([])`). Reachable again anytime via Privacy Ledger's "Why your archive is safe →" link. Dismissing ("Got it") always returns to `'main'`, not back to wherever it was opened from — deliberately shallow, no back-stack.

## Link-Rot Insurance (report #3)

Best-effort: a dead source page shouldn't kill the ↗ Source link forever. After a real save succeeds, `ensureArchived(url)` runs **fire-and-forget** (`.catch(() => {})`, not awaited) — never blocks the save or delays the toast; any failure (timeout, network error, archive.org declining) is silent.

- Keyed by the **source page URL**, in `chrome.storage.local.archivedUrls: Record<url, snapshotUrl>` — several clips from one article share one snapshot, and re-clipping that page weeks later into a different doc won't re-request it (`ensureArchived` checks the map first, and again right before writing, to survive two concurrent saves).
- `archiveSnapshot`: `GET https://web.archive.org/save/<url>` — free, no API key. `fetch` follows the redirect chain automatically, so `response.url` **is** the permanent snapshot address; no response parsing needed. 15s `AbortController` timeout.
- Requires the `https://web.archive.org/*` host permission (**needs a full reload**, same as any permission change).
- **Known gap:** if the MV3 service worker unloads before the fetch resolves, that one snapshot is silently skipped. Acceptable — it's a soft fallback, not core functionality, and the next clip retries for any still-unarchived page.
- UI: History's `archivedUrls` state loads once and stays live via a `storage.onChanged` listener, so the link can appear a few seconds after a save without reopening the drawer. `clipCard` shows **🏛 Archived** only when a snapshot exists for that entry's `sourceUrl`.
- Once a snapshot exists, `ensureArchived` also writes it **into the Doc itself** (see Doc bookmarks below) — the local `archivedUrls`/🏛-link UI is a convenience, not the source of truth; the Doc stays the durable copy, consistent with the Trust Card premise.

### Doc bookmarks (`NamedRange`) — shared primitive behind link-rot write-back and Living Resurface

A `NamedRange` marks a position in a Google Doc that **Google keeps in sync automatically** as the surrounding document is edited — the reliable "remember an exact spot, come back and edit near it later" building block. Created via a `createNamedRange` request folded into the *same* `batchUpdate` that writes the clip (no extra round trip); its `namedRangeId` comes back in that response's `replies[]` array, **parallel to `requests[]`** — `appendToGoogleDoc`/`appendImageToGoogleDoc` track the index they pushed each `createNamedRange` request at (`bookmarkIdx` / `captionRangeIdx`) to pull the right reply back out. Both functions **return** `{ clipNamedRangeId, captionNamedRangeId }` instead of `void`.

Two bookmarks get created:
- **Caption bookmark** — over `[captionStart, captionEnd-1]` ("domain · date"), created on every new-article save (text or image). Persisted in `chrome.storage.local.docCaptionBookmarks: Record<url, Record<destinationId, namedRangeId>>` (`saveCaptionBookmark`) — a page clipped into two different Docs gets an entry for each.
- **Clip-block bookmark** — over `[clipStart, end]`, where `end` is `note ? noteEnd-1 : clipEnd-1` (the whole block: bullet **plus its margin note, if one exists at save time** — so a later addition lands after both, not wedged in the middle). Created on **every** text-clip save. Stored directly on that `HistoryEntry.namedRangeId` — no separate lookup table. **Text clips only**; images don't get one.

`resolveNamedRange(docId, token, namedRangeId)` — `GET .../documents/{id}?fields=namedRanges` (partial response, cheap), linear-searches every name-group for the matching ID, returns the **last** sub-range's `endIndex`. Returns `null` if not found (e.g. the user deleted that part of the doc) — every caller treats that as a normal, silent "skip," except the one interactive path below.

**Two very different failure philosophies on top of the same primitive:**
- `appendArchiveLinkToDoc` (from `ensureArchived`) — **silent best-effort**: `getAuthTokenSilent()` (no prompt), try/catch, any failure just means no archive link this time.
- `handleAddDocNote` (behind `ADD_DOC_NOTE`, "+ Add a note" → "Add to Doc") — **interactive and real errors on purpose**. Uses `getAuthToken()` (may prompt) and throws a genuine `"Couldn't find that clip in the Doc anymore"` if the bookmark resolves to nothing — a deliberate user action, so silent failure would be wrong here. On success it patches the matching local `clips` entry (`savedAt === entrySavedAt`) so the History card reflects it immediately.

The dated note text (`(MMM D) your thought`) reuses `noteStyleRequests`, appended to the entry's stored `note` joined by `\n` — `.history-note` has `white-space: pre-line` so that renders as real line breaks.

## Living Resurface (report #8, pulled forward)

"+ Add a note" is available on **any clip with a Doc bookmark**, not just the Resurfaced spotlight — the write-back mechanism never cared which card triggered it, so restricting it to Resurfaced was a UI choice, not a technical one, and got lifted. In `Popup.tsx`, which card's note box is open is tracked by `noteOpenFor: number | null` (the clip's `savedAt`, a stable identity) — **not** by the render `key` string, since the same underlying clip can appear twice on screen (once as the Resurfaced spotlight, once again in the regular list below) and both instances should share one open/closed state. See "Doc bookmarks" above for the write mechanism.

## Soft Triage (report #4)

`HistoryEntry.someday` is pure local archive metadata (`toggleSomeday`, no Docs call, no bookmark needed — works on every clip regardless of age, unlike the bookmark-gated features above). Someday clips are hidden from the main list **by default**; the header's `🕒 Someday (N)` toggle (`showSomedayOnly`) is the one-click way back to them — this is the actual point (fewer things in view), not just an optional filter nobody remembers to use.

`pickResurfaced` excludes someday clips (already triaged once) and done-project clips (see Assignment/Project Mode). `pickTriageCandidate(clips, excludeSavedAt)` occasionally surfaces a `triageCard` — pool is not-someday, not today's Resurfaced pick, saved >14 days ago (`TRIAGE_MIN_AGE_MS`), needs ≥3 candidates, same daily-deterministic-pick shape as `pickResurfaced` but offset (`+7`) so the two rarely coincide. All three of its actions — *Yes, still relevant* / *Mark as Someday* / *Not now* — do nothing more than record `triageDismissedDay` (a day-seed in `chrome.storage.local`) so it won't ask again today; **skipping has zero consequence**, deliberately the opposite of Burn 451's delete-if-unread mechanic. Styled calm on purpose — dashed border, no accent color — distinct from Resurfaced's violet "delight" treatment.

## Gentle Reflection Nudge (report #5)

`pickReflectionNudge` walks the newest-first archive from the front, counting a streak of consecutive clips sharing the same `sourceUrl` with no `.note` (breaks on the first clip from a different page or with a note); fires at `REFLECTION_NUDGE_THRESHOLD = 5`. Pure local computation, same shape as Soft Triage — no background call, no new `HistoryEntry` field.

Dismissal (`reflectionNudgeDismissed: {url, count}`) is keyed by **streak length**, not just the URL: dismissing at 5 suppresses it, but if that same article's streak keeps growing to 8, it resurfaces — the pattern intensifying is worth a second nudge, an unchanged streak isn't. *"Look back"* sets the search box to the article's title (reuses the existing substring search); *"Dismiss"* records the dismissal — ignoring the nudge entirely does the same thing. Rendered between Resurfaced and Triage, and deliberately the lightest-weight of the three: no card box, no border, just an inline line.

## Deadline-Aware Citations (report #6)

`DocDestination.dueDate` (ISO `YYYY-MM-DD`) is local metadata like Someday, never written into the Doc. `deadlineStatus(dueDate, uncited)` computes `daysLeft` treating the due date as end-of-day (`T23:59:59`), so "due today" doesn't misread as overdue in the morning, and escalates **one status line** through three tiers — calm (>7d) / warn (3-7d) / danger (≤2d, today, or overdue) — rather than adding new elements as urgency increases.

`HistoryEntry.cited` is a one-way ratchet set by `handleCite` on a successful copy (never unset by re-clicking); the Cite button becomes **"✓ Cited"** once true, mirroring Someday's active-toggle look. `DocsTab` loads `clips`/`history` (in addition to `docStats`) to compute `uncitedCounts: Record<destinationId, count>`, kept live via the same `storage.onChanged` listener extended to watch `changes.clips` too.

The danger tier's **"Cite them →"** is a `<span onClick stopPropagation>` nested inside the status `<button>` (stopPropagation so it doesn't also fire the button's own "edit this deadline" handler) that calls `onJumpToHistory(doc.name)` — lifted through the `Popup()` root as `historyFilter` state, since `DocsTab` and `History` are siblings with no direct line to each other. `History` receives it as `initialFilter`, drops it into its own search box via a `useEffect`, then calls `onFilterConsumed()` to clear the shared state (so revisiting History later doesn't reapply a stale jump).

New semantic color token `--warn` (amber) sits alongside the existing `--danger` for the escalation ramp — kept separate from the violet `--accent`, per the design system's "accent reserved for ~4 tiny spots" rule.

### Custom calendar (`DeadlineCalendar`)

The date picker is a **custom calendar**, not a native `<input type="date">` — the native picker is OS-rendered and can't be themed, so it would clash with the rest of the drawer. `toISODate(d)` formats using **local** year/month/day components (deliberately not `toISOString()`, which reads UTC and can silently shift the date by a day depending on timezone) — this has to agree with `deadlineStatus`'s local-"today" comparison. Commits immediately on click (no separate Set step); dates before today are disabled; dismiss-on-outside-click via `composedPath()` + a ref, same pattern as the Drawer's avatar dropdown and the Toolbar's destination menu. `.cal-popup` is `position: absolute` anchored to `.deadline-row` (`position: relative`), floating over the list rather than pushing later cards down. Visually verified against the real `popup.css` at 340px before shipping — grid alignment, selected/today color treatment, and the floating shadow all confirmed via a headless-Chrome screenshot.

## Assignment/Project Mode (report #7)

`DocDestination.done` splits destinations across two sibling tabs: `DocsTab` shows only `docs.filter(d => !d.done)` (a doc vanishes from Docs the moment it's marked done), and `CompletedTab` shows only `docs.filter(d => d.done)`.

**This started as a collapsed section inside DocsTab** (matching History's Someday-filter pattern) **but was deliberately promoted to a third top-level tab** at the user's explicit request, after a critique was given and heard (a third tab is a permanent cost for rarely-visited content, and breaks the just-established Someday precedent — Hick's Law, tab-bar width risk at 340px, "Docs" would need a less-accurate rename). The user weighed it and chose the tab anyway. Visually verified at the real 340px width: three tabs fit with room to spare.

`DocsTab`'s `markDone(id)` (one-directional — a doc marked done immediately leaves DocsTab's own list, so there's no "un-mark" path from here) sets `done: true` and shows a flash ("Marked as done — see the Completed tab.") rather than auto-switching tabs — confirms where the item went without yanking the user away from whatever else they were doing in Docs. `CompletedTab` is a **fully independent sibling** — it can't reach into `DocsTab`'s state, so it loads its own `docs`/`docStats` and has its own `storage.onChanged` listener; safe because only one tab is ever mounted at a time. Its "↩ Reopen" sets `done: false` (flash: "Reopened — see the Docs tab."); "✕" removes the destination entirely.

**Card simplification (same session, follow-up):** the active doc card originally had two separate icon buttons (✓ mark done, ✕ remove) sitting next to the toggle switch. Consolidated into a single **`···` menu** (`DocMenu` component) containing both actions, so the card's button row stays down to just the toggle + one trigger — same floating-dropdown-with-outside-click-dismiss pattern as `DeadlineCalendar` and the Drawer's avatar menu. `menuOpenFor: string | null` tracks which card's menu is open (same shape as `editingDeadlineFor`). Visually verified against the real CSS: closed state is a clean two-control row, open state floats a small menu below the `···` trigger without clipping.

**"+ Set a deadline" also moved into this menu (follow-up to the follow-up)** — but only the *prompt* for adding one, not the deadline itself once it exists. `DocMenu` takes an optional `onSetDeadline`, passed only when `!doc.dueDate`; once a deadline is set, editing goes through the always-visible countdown pill (`onClick={() => setEditingDeadlineFor(doc.id)}`), not the menu — burying an active "danger" countdown behind a menu click would undercut the entire reason Deadline-Aware Citations exists (ambient, can't-miss urgency). The `.deadline-row` wrapper itself is now conditionally rendered (`isEditingDeadline || status`) rather than always present with an empty/link fallback — a doc with no deadline shows nothing extra at all now, no dangling row.

**Remove now asks first — inline, not a modal.** Requested as "show a warning modal"; countered and the user picked the alternative (design + psychology critique, per the standing practice — see the `critique-ux-ideas-first` memory): a real confirmation was warranted (removing silently drops the doc's deadline metadata, and "Remove" reads ambiguously close to "delete my Google Doc," which it never does), but a blocking modal-with-backdrop would've been the *first* one anywhere in SnipKeep — the whole drawer is deliberately `modal={false}`, page-stays-interactive, precisely because this is meant to be a companion, not something that takes over the screen. Built as an **inline swap** instead: `DocMenu` holds a local `confirming` boolean; clicking "✕ Remove" swaps the dropdown's own content (not a new surface) to a short reassurance — "Remove **sandeep2**? Your Doc and its clips stay safe — this only stops saving here." — with Cancel / Remove. The copy is doing real work: it answers the one thing someone would actually worry about at that exact moment, the same trust-reinforcement instinct behind the Trust Card and Privacy Ledger. `onRemove` only fires from the confirm click; Cancel drops back to the normal 3-item menu (not a full close) so a misclick doesn't cost an extra reopen.

**Readability pass (immediate follow-up).** The first version packed the question and the reassurance into one 3-line run-on sentence at 216px/12px padding — cramped, and the reassurance (the actually-important part, psychologically) had no visual distinction from the rest. Before touching anything, the actual WCAG contrast was computed rather than assumed: `--text-2` on `--surface` is **7.53:1**, `--danger` on `--surface` is **6.6:1** — both already comfortably past AA's 4.5:1, so contrast was never the real defect. The fix was hierarchy and room: split into `card-menu-confirm-title` ("Remove **sandeep2**?" — 14px bold, `--text`, own line) and `card-menu-confirm-text` (the reassurance — 12.5px, `--text-2`, own line) — two tiers instead of one paragraph, so the reassurance can be scanned independently rather than parsed out of a sentence (chunking, Miller's Law). Card widened 216px → 240px and padding 12px → 16px so the reassurance wraps across two even lines instead of three cramped ones. Cancel/Remove buttons grew from `padding: 6px 11px` (borderline ~26px tall) to `8px 14px` + explicit `min-height: 32px`, comfortably past WCAG 2.5.8's 24px target-size floor rather than sitting right at the edge of it.

**Menu item alignment/spacing pass (same session).** The 3-item list (Set a deadline / Mark as done / Remove) rendered each item as a single inline string ("+ Set a deadline"), so the icon glyphs (`+`/`✓`/`✕` — three very different natural widths) left every label starting at a slightly different x position. Fixed with a `.card-menu-icon` fixed-width (14px) flex column per item, so all three labels now line up on the same left edge regardless of which glyph precedes them. Item padding grew `7px 9px` → `8px 9px` with an explicit `gap: 1px` between items at the `.card-menu` container level (previously relying on padding alone with no defined rhythm between rows) for a clearer, more consistent vertical cadence. A `.card-menu-divider` now separates **Remove** from the two safe/reversible actions above it — the same "give the destructive item distance" convention used in macOS/VS Code context menus, so a quick double-click right after Mark as done doesn't land on Remove by muscle memory (error prevention, not just decoration). (Classes were `.doc-menu*` at the time; renamed to `.card-menu*` once the History card started reusing them — see below.)

`done` is **deliberately independent of `active`** — marking a project done doesn't silently hide it from the toolbar, and reopening doesn't silently restore that either; both stay under the user's explicit control. `History` also loads `docs` to build `doneDestIds: Set<string>`, kept live via its own `storage.onChanged` handler; before calling `pickResurfaced`/`pickTriageCandidate`/`pickReflectionNudge`, entries are narrowed to `activeEntries` (excludes clips whose `destinationId` is done). Only the **proactive pickers** are affected — the main searchable History list is untouched, so a finished project's clips stay fully findable and citable, they just stop being surfaced unprompted.

## Topic Auto-Clustering (report #10) — built, then removed

Shipped as a row of tag/domain pill chips above History's search box (each click dropped its label into the search query), then **fully removed** 2026-07-06 after a UX critique — deleted, not paused (`pickTopicClusters`, `extractTags`, `TopicCluster`, and the `.topic-*` CSS are all gone). Two reasons it didn't earn its place:

1. **No signal at realistic scale.** The chips showed unconditionally, so a domain that covered ~100% of a small archive produced a chip that filtered to "everything," and a just-applied tag produced a chip revealing nothing. That's a progressive-disclosure failure — complexity shown when it has nothing to say.
2. **Duplicated an existing affordance.** The recognition/browse value it targeted (recognition-over-recall vs. the blank search box) was already delivered inline: every `#tag` on a card is a clickable filter (`renderNoteWithTags`) and each card shows its source domain. The chips mostly re-surfaced what the cards already exposed; their only unique value (aggregate counts + off-screen clusters) only matters in a large, varied archive.

**One keeper from that work:** History's search predicate still includes `e.sourceUrl.toLowerCase().includes(q)` — originally added so domain chips would match, now retained as an independently useful capability (typing a bare domain like `nytimes.com` filters History by site). If clustering is ever revisited, it should appear only at real scale behind a hard "the cluster must actually discriminate" gate (e.g. exclude any cluster covering most of the archive), never shown unconditionally.

---

## Pre-roadmap capture features

### History navigation, citations, tags (`src/popup/Popup.tsx`)

The History tab reveals per-clip actions on hover/focus: **↗ Source** (`sourceHref` builds a Text Fragment `#:~:text=start,end` so the browser highlights the clip; images/empty → plain open) and **📄 Doc** (`docHref` → `docs.google.com/document/d/<destinationId>/edit`, hidden for legacy entries lacking the id or for Notion). Plain `<a target="_blank">` links — the popup runs in the content-script context, so `chrome.tabs` is unavailable (same constraint as `chrome.identity`).

**⧉ Cite** builds a citation (`formatCitation` → APA/MLA/BibTeX) from the clip's metadata and copies it (`copyToClipboard`: `navigator.clipboard` with an `execCommand` textarea fallback; needs the `clipboardWrite` permission). Style is chosen once via the header toggle, persisted to `chrome.storage.sync.citationStyle`. No author is captured, so `siteName(url)` (registrable-domain label) stands in as the group author and `savedAt` is the retrieval/accessed date. See Deadline-Aware Citations above for `HistoryEntry.cited`.

Cards render the clip's **margin note** (`↳ …`) with any **`#tags`** as clickable chips (`renderNoteWithTags`) that set the search box to that tag — tags filter via the existing note-substring match, no separate tag index.

**Card action row split (same session, follow-up).** Originally up to 5 conditional buttons (Source, Archived, Doc, Cite, Add a note, Someday) could appear on one card, and overflowed the 340px width whenever several were present at once. Split the same way as the Doc card's own redesign: **Source, Doc, Cite stay visible** — all three are frequent "do something with this content right now" actions, and Cite specifically is the landing target of Deadline-Aware Citations' "Cite them →" jump, which expects an immediately clickable button, not a menu click. **Archived, Add a note, Someday moved into a `···` menu** (`HistoryCardMenu`) — all three are occasional, fallback, or organizational (you don't triage or annotate a clip on every visit; the Reflection Nudge already exists to prompt notes at the right moment, so this menu doesn't need to carry that job too). `HistoryCardMenu` reuses the exact same `.card-menu` CSS as the Doc card's own overflow menu (renamed from `.doc-menu*` → `.card-menu*` once it became shared by both cards) rather than duplicating styles — same dismiss-on-outside-click pattern, same visual language. `cardMenuOpenFor: number | null` (keyed by `savedAt`, same shape as `noteOpenFor`) tracks which card's menu is open. The visible row is now a stable 3 buttons + 1 trigger regardless of which optional items apply to a given clip, instead of a variable-width row that could silently overflow depending on which conditional buttons happened to be present.

### Toolbar (`src/content/Toolbar.tsx`)

The floating pill: `[Save to X] [✎] [···]`, in its own Shadow root (`#snipkeep-host`). Feedback states (`saving`/`saved`/`error`) replace the buttons in place. `showToolbar(rect, text, links)` in `content/index.tsx` captures `text` and `links` as a closure, so a save no longer depends on the live selection (arrow keys / focus changes that collapse it are harmless).

**Margin notes (✎).** The pencil toggles a note panel (textarea) below the pill. Enter = save-with-note, Shift+Enter = newline, Esc closes the panel (not the toolbar). `···` gets a matching `.active` background when its dropdown is open.

**Keyboard control.** Once the toolbar is visible, `onGlobalKeyDown` (registered on `document` in **capture** phase) drives it via `toolbarApiRef.current.handleNavKey(key)`:
- **Enter** → save to the active destination (default highlight is Save).
- **←/→** → move the highlight across `Save → ✎ → ···`; Enter on ✎/··· opens that panel/menu.
- **Esc** → dismiss.
- Guards (all required): toolbar must be visible; bail if the *deep* target is editable (`isEditableTarget(deepTarget(e))` — `deepTarget` reads `composedPath()[0]` because a document listener retargets `e.target` to the shadow host); bail if the event originates inside the toolbar; ignore modifier combos and Enter key-repeat.
- `navActive` stays false until the first arrow, so mouse users never see a stuck highlight ring; `savingRef` is a synchronous re-entrancy guard against a double-Enter double-save.
- **Deliberately NOT done:** hijacking bare arrows to adjust the selection, or summoning the toolbar from a keyboard selection — both fight native text selection / caret browsing. The toolbar is summoned by `mouseup` only.

The end buttons carry the pill's 8px inner radius so the highlight's inset ring follows the corner instead of being clipped square by the toolbar's `overflow: hidden`.

### Google Docs formatting (`appendToGoogleDoc`)

Per save: GET the doc for its `endIndex`, then one `batchUpdate`. Clips from the **same article** (consecutive same URL per destination) group under **one heading**; a different URL starts a new block.

- **New article block:** `Heading 2` (page title) + caption `domain · date` (9pt grey, domain hyperlinked) + first clip as a bullet.
- **Continuation:** just another bullet.
- Spacing constants enforce hierarchy via proximity — `BLOCK_GAP_PT` ≫ `HEADING_BELOW_PT` / `CAPTION_BELOW_PT` / `BULLET_BELOW_PT`. `isFirstBlock` suppresses the lead-in gap on an empty doc.
- Clip text is **verbatim**, except `normalizeSelectionText()`: single `\n` → space (visual wrap), `\n\n` → `\n` (real paragraph break → its own bullet).
- **Margin note** → `noteStyleRequests()`: inserted as `↳ note`, indented italic muted-violet, *after* the clip, in both branches.
- **Preserved links** → `linkStyleRequests(clipStart, links)`: each `LinkSpan` styled as link + color + underline, offset by `clipStart`.

**Index math (the sharp edge):** every style/bullet/link request uses absolute indices computed from a **single** `insertText`. `createParagraphBullets`/`updateTextStyle`/`updateParagraphStyle` don't change the character count, so those absolute indices stay valid. Both JS `.length` and Docs indices are **UTF-16** units, so they align (incl. the `↳` glyph = 1 unit).

### Images (`appendImageToGoogleDoc`, `handleSaveImage`)

Right-click an image → context menu → `CAPTURE_IMAGE` → content reads `naturalWidth/Height` + title → `SAVE_IMAGE` → background inserts via `insertInlineImage`. Same article-grouping as text.
- `fitImageSize(w, h)` scales natural px → PT (×0.75), capped at `MAX_W_PT = 468`, preserving aspect.
- The image request is pushed **last** in the batch so it doesn't shift heading/caption style indices before it.
- **The URL must be public** http(s) and ≤ 2000 chars — Docs/Notion fetch it server-side. `data:`/`blob:` and login-gated images are guarded/will fail.
