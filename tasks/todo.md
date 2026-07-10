# Bring-your-own-AI-key connection flow (docs/IDEAS.md #3, connection UX only)

Lets a user connect ChatGPT (OpenAI), Claude (Anthropic), or Gemini (Google)
by pasting their own API key — SnipKeep never sees or relays it; requests go
straight from the background worker to the user's own provider. This pass is
the **connect/manage flow only** — no summarize/follow-up actions yet (those
were scoped as a later slice in the original idea).

## Design
- **Storage:** `chrome.storage.local.aiConfig: { provider, apiKey }` — local,
  not sync, since a raw API key is more sensitive than the Notion token
  already synced; deliberately doesn't leave the device via Google account
  sync.
- **Validation before storing:** background does a lightweight GET against
  each provider's models-list endpoint (cheap, no completion cost) to confirm
  the key actually works before persisting it:
  - OpenAI: `GET https://api.openai.com/v1/models`, `Authorization: Bearer <key>`
  - Anthropic: `GET https://api.anthropic.com/v1/models`, `x-api-key: <key>` + `anthropic-version: 2023-06-01`
  - Gemini: `GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>`
- **Where the call happens:** background only (matches "Background... All API
  calls" — content-script fetches are subject to the host page's CSP, same
  reason Google Docs/Notion calls already live there, not in Popup/Drawer).
- **Raw HTTP, not the Anthropic SDK:** the claude-api skill's default is the
  official SDK when available, but this codebase has zero SDK dependencies
  for any external API today — Google Docs and Notion are both called via
  plain `fetch` from the MV3 service worker (bundle-size- and
  runtime-conscious). Matched that existing pattern for all three providers
  rather than introducing an SDK for just one.
- **UI placement — "showcase outside, hidden inside":** a small always-visible
  "✨ AI" button sits in the Drawer header (next to the avatar) — the
  showcase/branding entry point, visible whether or not a key is connected.
  Clicking it swaps the body into a new `view: 'ai'` state (same
  `view: 'main'|'privacy'|'trust'|'ai'` pattern as Privacy Ledger/Trust Card
  — a nested screen, not a 4th tab, so it doesn't add to the Docs/Completed/
  History tab bar per the Hick's-Law precedent already set for Completed).
  The avatar dropdown does NOT get a duplicate entry — one path in, to avoid
  redundant clicks to the same screen.
- **Provider picker → deep link to the key page:** selecting a provider calls
  `window.open(url, '_blank')` (works directly from the content-script
  context — no `chrome.tabs` messaging needed, since `window.open` is a
  standard web API) pointed at that provider's own API-key page, and reveals
  a "paste your key" field + Connect button inline.
  - ChatGPT → `https://platform.openai.com/api-keys`
  - Claude → `https://console.anthropic.com/settings/keys`
  - Gemini → `https://aistudio.google.com/app/apikey`
- **Connected state:** shows which provider + a masked key + Disconnect.
  Fully invisible unless connected or the user opens the AI screen — no
  buttons/actions render anywhere else until a key exists (out of scope for
  now, since the summarize/follow-up actions aren't built yet).

## Tasks
- [x] manifest.json — host_permissions for api.openai.com, api.anthropic.com, generativelanguage.googleapis.com (FULL reload needed)
- [x] types.ts — AIProvider, AIConfig, ConnectAIMessage/Response, DisconnectAIMessage/Response
- [x] background — CONNECT_AI handler (validate via provider's models endpoint, store to storage.local), DISCONNECT_AI handler (remove)
- [x] Drawer.tsx — 'ai' DrawerView, header showcase button, render AIAssistant
- [x] Popup.tsx — AIAssistant component (provider picker, key input, connected/disconnect state)
- [x] popup.css — .ai-* styles reusing existing tokens/card patterns
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified CONNECT_AI/DISCONNECT_AI/aiConfig compiled into the background bundle and the 3 host permissions compiled into dist/manifest.json

## Status: DONE (built). Needs FULL extension reload (new host_permissions).
Not yet manually click-tested in Chrome — connect flow (window.open to the
provider's key page, paste key, validate, store) and disconnect were traced
carefully but not driven live.

## Follow-up: the two consumer actions (same session, user connected a real Claude key)

Added the actions this connect flow was originally scoped to enable.

### Design (per explicit UX/psychology request)
- **Hick's Law:** neither action is a new always-visible button in a card's
  action row — both live behind the existing "···" overflow menu, so the
  primary row (Source/Doc/Cite for clips; toggle/menu for docs) stays exactly
  as uncluttered as before.
- **Error prevention / invisible-until-opted-in:** `onAskFollowUp`/
  `onSummarize` are `undefined` (not just disabled) when no AI key is
  connected — omitted from the menu entirely rather than shown as a dead,
  greyed-out click that would need its own explanation.
- **Jakob's Law / consistency:** both actions reuse ONE new shared panel
  shape (`.ai-summary-box`), deliberately modeled on the already-shipped
  "+ Add a note" `.doc-note-box` — reveals below the card, same status-line
  pattern for loading/error feedback. No new interaction vocabulary invented
  for "AI stuff."
- **No silent operations:** every request shows "Thinking…"/"Summarizing…"
  immediately, then either the result or a real error string (key rejected,
  rate limited, generic failure) — never a silent no-op.
- **Follow-up questions stays true to the original critique:** the prompt
  explicitly asks for 3 QUESTIONS, never a written reflection — the model
  points at where to look, the student still does the thinking themselves.

### Implementation
- One shared `callAI(system, prompt)` adapter in background/index.ts,
  dispatching on `aiConfig.provider`. Fast/cheap models (utility calls, not
  heavy reasoning): `gpt-5-nano` / `claude-haiku-4-5` / `gemini-flash-latest`
  (a durable Google alias, not a dated snapshot, so it won't silently break
  when a specific version is retired).
- `ASK_FOLLOWUP` (History, per-clip): background asks for exactly 3
  questions, one per line; parsed client-side, rendered as a list.
- `SUMMARIZE_TOPIC` (DocsTab, per-doc): DocsTab now keeps the raw `clips`
  array (previously only derived `uncitedCounts` from it) so it can filter
  by `destinationId` and send each clip's text; background returns one
  3-5 sentence overview.

## Tasks
- [x] types.ts — AskFollowUpMessage/Response, SummarizeTopicMessage/Response
- [x] background — callAI adapter (3 providers), aiErrorMessage, handleAskFollowUp, handleSummarizeTopic, ASK_FOLLOWUP + SUMMARIZE_TOPIC listeners
- [x] Popup.tsx — DocsTab: allClips/aiConnected state, handleSummarize, DocMenu.onSummarize + summary panel; History: aiConnected state, handleAskFollowUp, HistoryCardMenu.onAskFollowUp + questions panel
- [x] popup.css — shared .ai-summary-* panel + .ai-followup-list
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified ASK_FOLLOWUP/SUMMARIZE_TOPIC/model ids compiled into background bundle, UI strings/classes into content bundle

## Status: DONE (built). No manifest change beyond the already-added host
permissions → plain reload sufficient for this slice.

## Follow-up: live-tested against a real connected key, found + fixed 2 real bugs

### Bug 1 — generic "key was rejected" hid the real cause
`aiErrorMessage` guessed a message from the HTTP status code alone (401/403
→ "rejected") instead of reading the provider's own error body. Anthropic's
actual error was completely different (see Bug 2) but got mislabeled as a
bad key, sending the user to reconnect a key that was never the problem.
Fixed: `aiErrorMessage` now reads `body.error.message` from the response
(all three providers shape their error JSON the same way) and surfaces that
verbatim, falling back to the generic guess only if the body isn't JSON.
`validateAIKey` now routes through the same helper instead of its own
separate (and equally generic) status-code guess.

### Bug 2 — Anthropic blocks direct browser calls without an explicit opt-in
Real error surfaced once Bug 1 was fixed: "CORS requests must set
'anthropic-dangerous-direct-browser-access' header." Anthropic's API
rejects browser-origin requests by default (anti-abuse — stops a site from
silently draining a visitor's key) unless that header is present; this is
unrelated to the extension's own `host_permissions` (which bypass the
*browser's* CORS enforcement, not Anthropic's own server-side check) — both
layers were needed. Fixed: added `'anthropic-dangerous-direct-browser-access':
'true'` to both Anthropic fetch calls (validateAIKey's GET /v1/models AND
callAI's POST /v1/messages) — the same flag the official SDK sets under
`dangerouslyAllowBrowser`, and the documented, sanctioned opt-in for exactly
this architecture (user's own key, called straight from their own browser
extension, never proxied through a server SnipKeep doesn't have).

## Tasks
- [x] aiErrorMessage — read body.error.message instead of guessing from status code
- [x] validateAIKey — route through aiErrorMessage instead of its own separate guess
- [x] both Anthropic fetch calls — anthropic-dangerous-direct-browser-access header
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified header string compiled into both call sites in the background bundle

## Status: DONE (built). Confirmed against a real connected Claude key via
live user testing — this is the first part of the whole AI feature actually
verified end-to-end in Chrome, not just traced. OpenAI/Gemini call sites
untested (no key connected for those yet) — if either misbehaves, check for
a similar provider-specific browser-auth quirk first.

---

# Auto-generated bibliography (docs/IDEAS.md #2)

A "Works Cited" section, auto-maintained at the end of the Doc — deduplicated
by source, alphabetized, rebuilt fresh every time a citation is added. Turns
per-clip citations (already shipped) into an actual finished-paper reference
list instead of something the user has to manually assemble.

## Design
- **Trigger: the existing Cite action, not every save.** "Self-updating as
  citations get added" (the idea's own wording) maps naturally onto the Cite
  button that already exists — not onto silently citing every single clip.
  Only fires on the FIRST citation of a clip (already gated by the existing
  `!entry.cited` one-way-ratchet check) — re-clicking Cite just re-copies,
  no extra Docs API round-trip.
- **Rebuilt from scratch every time, not appended to.** The only way to keep
  the list both correctly ordered (alphabetical, and the sort can change as
  sources are added) AND actually pinned to the bottom (any stale copy is
  deleted first, the fresh one goes at the doc's current true end) — same
  `endOfSegmentLocation` pattern a new clip uses.
- **Dedup key is the source PAGE, not the clip** — several clips from one
  article must produce exactly one bibliography entry, not one per clip.
- **Google Docs only** — same boundary as Living Resurface/archive-link
  (Notion hidden at MVP); gated on `destinationId !== 'notion'`.
- **Fire-and-forget from the UI.** The clipboard copy already gives the user
  their "Copied ✓" confirmation; the Doc write-back is a bonus, so a failure
  there fails silently rather than surfacing an error for the secondary part
  of the action.
- **Known limitation, documented not hidden:** repositioning only happens on
  a Cite action — clips saved afterward without citing anything new won't
  push it back down again. And changing citation style after some clips are
  already cited won't retroactively reformat entries already in the list
  until each is cited again.

## Implementation
- `resolveNamedRange` extended to also return `startIndex` (previously only
  `endIndex`, enough for "insert after" but not for "delete this whole
  range") — additive, existing call sites (archive-link, add-doc-note) only
  ever read `.endIndex` and are unaffected.
- New `worksCitedBookmarks: Record<destinationId, namedRangeId>` in
  storage.local, same shape/precedent as `docCaptionBookmarks`.
- `updateBibliography()`: resolve + delete any existing block → re-fetch the
  doc's current end → insert `Works Cited` (HEADING_2) + the citation list →
  bookmark the new block's NamedRange → store the new id.
- `buildWorksCited()` (Popup.tsx): filters `clips` by destinationId + cited,
  dedupes by sourceUrl, formats via the existing `formatCitation`, sorts.

## Tasks
- [x] types.ts — UpdateBibliographyMessage/Response
- [x] background — resolveNamedRange returns startIndex too; updateBibliography (delete-then-rebuild-at-end); UPDATE_BIBLIOGRAPHY listener
- [x] Popup.tsx — buildWorksCited helper; handleCite sends UPDATE_BIBLIOGRAPHY on first citation of a gdoc clip
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified UPDATE_BIBLIOGRAPHY/worksCitedBookmarks/skworkscited/"Works Cited" compiled into the background bundle, UPDATE_BIBLIOGRAPHY into the content bundle

## Status: DONE (built). No manifest change → plain reload.

## Follow-up: live-tested, found + fixed a real bug (same session)

Live testing surfaced two things:

**Dedup by source page works as designed** — citing two clips from the same
article correctly collapsed to one Works Cited entry. Not a bug; confirmed
with the user this is real bibliography convention (one reference entry per
source, even if quoted multiple times), not data loss.

**Real bug: re-citing an already-cited clip in a different style didn't
update the Doc.** User cited a clip as APA, then reopened Cite and picked
BibTeX — clipboard got the BibTeX text, but the Doc's Works Cited section
still showed the old APA entry. Root cause: the write-back was gated on
`!entry.cited`, so it only ever fired on a clip's FIRST citation — the
originally-documented "known limitation" about style changes not
retroactively updating older entries was actually broader than described:
it also blocked updating on a deliberate re-cite of the SAME clip.

Fixed by decoupling the two concerns that were sharing one `if`: the
cited-flag bookkeeping stays a one-way ratchet (`!entry.cited` gate, as
before), but the Works Cited write-back now runs on EVERY successful cite —
first time or a re-cite — and always rebuilds the WHOLE list using
whichever style was just picked. This is strictly better than "fix just
this clip's entry": the entire section now stays in one consistent style
after any cite action, fully closing the earlier-documented limitation
rather than only patching this one symptom of it.

## Tasks (follow-up)
- [x] Popup.tsx handleCite — split cited-flag bookkeeping (still `!entry.cited`-gated) from the Works Cited write-back (now runs on every successful cite, rebuilding with the just-picked style)
- [x] tsc clean (only the 3 known pre-existing errors) + build

## Status: DONE (built). No manifest change → plain reload. Confirmed via
live user testing that dedup-by-source works correctly; the re-cite/
style-update path is fixed but not yet re-tested live by the user.

## Follow-up: failure feedback for the Doc write-back (same session)

The write-back was fire-and-forget with zero feedback either way — after two
rounds of "why didn't this work," a silent failure isn't acceptable even for
a "bonus" action. Reusing the Cite button's existing Copied/Copy-failed
flash slot rather than adding a new UI element: stays silent on success (the
clipboard flash already confirms the primary action), shows "Doc update
failed" in that same slot on failure. Can land a beat after the clipboard
flash already cleared, since the Doc write is a network round-trip.

## Tasks (follow-up)
- [x] Popup.tsx — feedback state gains an optional `label` override; handleCite awaits UPDATE_BIBLIOGRAPHY and shows "Doc update failed" on failure/error only
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified "Doc update failed" compiled into the content bundle

## Follow-up: the feedback was invisible in practice — actions row collapsed before it could show (same session)

Real bug, caught by the user with a screenshot: `.history-actions-row` is
pure reveal-on-hover (`:hover`/`:focus-within`). The Cite style dropdown
floats down over the NEXT card in the list — the instant you click a style
and the dropdown closes, the cursor is physically sitting over that next
card, not the one you clicked from. `:hover` is lost immediately, collapsing
the row (and the Copied/Doc-update-failed feedback rendered inside it,
which is exactly what just landed there) before it's ever visible.

Fixed with a third, JS-driven condition alongside the two CSS pseudo-classes:
`.history-item.show-actions .history-actions-row` stays expanded whenever
`feedback?.key === key` for that card, regardless of real cursor position.
Self-clearing — once the feedback's own timeout fires, the class stops being
applied and the row reverts to normal hover behavior.

## Tasks (follow-up)
- [x] Popup.tsx — history-item gets `show-actions` class while `feedback?.key === key`
- [x] popup.css — `.history-item.show-actions .history-actions-row` added alongside the existing :hover/:focus-within selector
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified `show-actions` compiled into the content bundle

## Follow-up: DocsTab's FLIP reorder made gentler on request (same session)

Same "make it gentle/soft/slow" ask, applied to the doc-card reorder
animation this time (`DocsTab`'s `.animate()` call). Kept the existing
`cubic-bezier(0.65, 0, 0.35, 1)` easing — already the deliberate, numerically
verified genuinely-symmetric slow-in/slow-out curve, not something to
replace — and extended the timing constants instead: base duration
460ms→640ms, cap 780ms→1100ms, per-pixel distance scaling 0.4→0.5ms/px, and
the per-card stagger cap 150ms→180ms (25ms/index instead of 20ms) so
multiple cards moving at once cascade more visibly rather than nearly
overlapping.

## Tasks (follow-up)
- [x] Popup.tsx — DocsTab FLIP reorder duration/delay constants extended (same easing curve, kept as-is)
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified new constants compiled into the content bundle

## Follow-up: real jerk bug at animation start, found + fixed (same session)

User reported a sudden jerk right when clicking the toggle — real, not a
perception issue. Root cause: `el` (the animated `.doc-item`) also has a CSS
`transition: background 0.15s, box-shadow 0.15s` on `:hover` — and the mouse
is necessarily already hovering it (that's how the click happened), so that
hover transition starts on the exact same frame as the JS slide animation.
`box-shadow` forces a main-thread repaint (unlike `transform`/`opacity`,
which the compositor handles independently) — both competing for the same
frame is what read as a stutter right at the start.

Fixed with `will-change: transform, opacity`, applied right before
`el.animate()` and cleared on the animation's `finish`/`cancel` events —
promotes the card to its own compositor layer for exactly the animation's
duration, isolating the slide from the concurrent hover repaint, without
leaving every card permanently layer-promoted (which costs memory).

## Tasks (follow-up)
- [x] Popup.tsx — will-change toggle wrapping the FLIP .animate() call, cleared on finish/cancel
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified willChange compiled into the content bundle

## Follow-up: will-change alone didn't fix it — the real ask was choreography, not paint (same session)

User reported the jerk was still there after the will-change fix, then
described the actually-wanted behavior precisely: "stay at its current
position for a while, then gently moves and reorders." That's a timing/
choreography gap, not a rendering-performance one — `delay` was previously
`Math.min(180, index * 25)`, meaning the first card (often the toggled one)
had ~0ms before motion started. Click and the start of the slide landed on
the same frame, reading as an instant cut into motion.

Fixed with a flat 140ms hold added in front of the existing stagger
(`delay = 140 + Math.min(180, index * 25)`) — every card now genuinely sits
still at its current position first, then glides into place: "click, pause,
move," not "click, move." The will-change fix from the previous pass stays
in place (still a real, valid improvement) — this is additive, not a
replacement.

## Tasks (follow-up)
- [x] Popup.tsx — REORDER_HOLD_MS (140ms) flat delay added before the existing per-card stagger
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified compiled into the content bundle

## Follow-up: full interaction audit on request — found the actual root cause (same session)

User asked for a full revamp/analysis of the toggle→reorder interaction
after the hold-delay pass still didn't fix it. Systematic re-read of every
piece (toggle button CSS, handleToggleDoc, the full FLIP effect, doc-item
CSS, and the divider) surfaced the real bug:

**The actual root cause — `fill: 'none'` on the WAAPI animation.** A Web
Animations API effect's keyframes only apply during its ACTIVE phase, not
during `delay`. With `fill: 'none'` (what every prior pass had), the card
had NO transform/opacity override for the entire hold window I'd just
added — it sat at its real, final, already-reflowed position from the
instant React re-rendered. Then when the active phase started after the
delay, the first keyframe (the OLD position) snapped it BACKWARD for a
frame before sliding forward. Actual sequence: click → jump to final spot →
sit there → jump BACK to start → slide forward — objectively worse than no
delay, which explains why the hold-delay pass made it feel more broken
rather than less. Fixed with `fill: 'backwards'`, which holds the first
keyframe's values for the entire delay — the card now genuinely stays put
until the active phase begins.

**Secondary finding — the divider had zero animation.** `.doc-list-divider`
("Hidden from toolbar") mounts/unmounts entirely (not a class toggle)
whenever a toggle crosses the active/inactive boundary, and had no
animation at all — a second, un-tracked source of abruptness on
boundary-crossing toggles specifically. Fixed by reusing the existing
`cn-add-reveal` keyframe (already used for `.add-form`'s entrance) rather
than inventing a new one — CSS `animation` auto-plays on element insertion,
no JS needed. Exit (removal) still pops instantly; animating that needs a
JS-driven unmount delay, left out of scope.

**Ruled out, not bugs:** the toggle switch's own knob slide (already
`transform`-based, compositor-only, correctly smooth); `handleToggleDoc`
(single `setDocs` call, one render, no double-update); `activeDocs` sort
stability; the `will-change` fix from the previous pass (still valid,
unrelated to this bug, left in place).

## Tasks (follow-up)
- [x] Popup.tsx — animation fill changed from 'none' to 'backwards' (the actual fix)
- [x] popup.css — .doc-list-divider gets an entrance animation (reused cn-add-reveal)
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified both compiled into the content bundle

## Follow-up: one more polish round — interruption continuity + choreography sync (same session)

Three remaining defects, all in the immediately-after-click window:

**1. Rapid re-toggle snapped the card.** A second toggle while the first
slide was still mid-flight created a new animation from the stale LAYOUT
delta — offsetTop deliberately ignores transforms (right for layout truth,
wrong for visual truth), so the card snapped from wherever it visually was
to a computed start point. Fixed with interruption continuity: a
`runningAnims` ref tracks our own FLIP animation per card (deliberately NOT
`el.getAnimations()`, which would also return — and cancel — the card's CSS
hover transitions); on interruption, the in-flight transform is read from
computed style and folded into the new delta (the new slide starts at the
card's current visual position), in-flight opacity carries over as the new
start opacity, the old animation is cancelled, and the 140ms hold is
skipped (a card frozen mid-air reads as a hang, not a beat). `interrupted`
is also its own animation trigger: a quick toggle-back can land on dy≈0
with the same target opacity, but the card is still visibly displaced and
needs an animated path home, not a snap. Duration now scales with the
VISUAL distance remaining, so a nearly-home interrupted card gets a short
remainder, not a full restart.

**2. Stale cancel event could strip will-change under the new animation.**
Animation cancel events fire async — the old animation's cleanup listener
runs AFTER the new animation is registered and mid-flight. Fixed with
guarded cleanup (`clearPromotion` only acts if it's still the animation on
record for that card).

**3. Choreography holes.** (a) The divider faded in immediately on click,
while held cards were still transformed over its freshly-allocated layout
slot — it materialized underneath a card that hadn't moved yet. Now enters
with animation-delay 0.14s (KEEP IN SYNC with REORDER_HOLD_MS), backwards
fill, and the same easing curve as the slide, so it fades in exactly as the
space clears. Reduced-motion disable added. (b) Hovering an inactive card
snapped opacity 0.5→0.85 — opacity was never in .doc-item's transition
list. Added (0.2s); doesn't fight the FLIP's opacity animation since a
WAAPI animation outranks a CSS transition for the whole time it's active.

## Tasks (follow-up)
- [x] Popup.tsx — runningAnims ref, interruption continuity (visual-delta fold-in, opacity carry, hold skip, interrupted-as-trigger), guarded clearPromotion cleanup
- [x] popup.css — divider entrance delayed/eased to match the hold + reduced-motion; .doc-item transition gains opacity
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified DOMMatrixReadOnly, the divider animation string, and the opacity transition all compiled into the content bundle

## Follow-up: "Add document" control joins the FLIP pass (same session)

User spotted the last teleporting element: the "Add document" control is
anchored after the LAST ACTIVE card, so any toggle that changes which card
that is moves it — and it was the one element in the list jumping instantly
while everything around it glided (it was never measured by the FLIP
effect, which iterated doc cards only).

Restructured the effect from "iterate activeDocs" to "iterate participants"
— every doc card plus the add control under a sentinel key
(`__add-control`), with its stagger index slotted at lastActiveIdx + 1
(exactly where it renders). Same hold/easing/duration/interruption logic
applies uniformly. Two wrinkles handled:
- The control REMOUNTS as a new DOM node when it moves (it renders inside a
  different card's Fragment). Fine for FLIP — position history is keyed by
  the sentinel, not element identity — but interruption continuity now
  checks the running animation's `effect.target === el` before folding
  in-flight transform/opacity (a still-running animation may belong to the
  detached previous node, whose offset is meaningless for the fresh one).
- Both addControl variants (trigger button AND expanded add-form) feed the
  same ref, so whichever is mounted participates.

## Tasks (follow-up)
- [x] Popup.tsx — participants restructure (cards + add control), addControlEl ref on both JSX variants, sameEl guard on in-flight fold-in, doc.id→key/doc.active→active throughout the loop
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified __add-control sentinel compiled into the content bundle

## Follow-up: ghost slide of the add control on every drawer open (same session)

Side effect of making the add control a FLIP participant, caught by the
user with a screenshot: on drawer open, the add control slid from the top
of the list down to its real spot. Cause: docs arrive ASYNC from
chrome.storage on every fresh mount, so render 1 is always an empty list —
where the add control is the only content, at the top — and render 2 is
populated. The add control exists in both renders, so it alone carried
position history across the transition; FLIP animated "top → after last
active card" as if it were a reorder, while the cards (correctly) didn't
animate at all. Data arriving is not movement.

Fixed with an initial-population guard: if no CARD has position history
yet (`!activeDocs.some(d => prevTops.current.has(d.id))`), the render is a
population, not a reorder — every position is recorded, nothing animates.
Covers drawer open, tab-switch-back remounts, and the delete-all-then-add
edge; normal toggles are unaffected (cards have history by render 3).

## Tasks (follow-up)
- [x] Popup.tsx — isInitialPopulation guard added to the FLIP animate condition
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified guard compiled into the content bundle

## Follow-up: same ghost-motion bug on the divider, via CSS instead of FLIP (same session)

User caught the "Hidden from toolbar" divider doing the same thing on
drawer open. Different mechanism, same root cause: the divider's entrance
is a CSS MOUNT animation, and CSS can't know WHY the element mounted — a
toggle crossing the active/inactive boundary (should animate) vs. the docs
simply arriving from async storage on drawer open (should not). The
isInitialPopulation guard only covered the FLIP JavaScript path, so the
divider still played its reveal over a list that was loading, not
reordering.

Fixed by gating the animation behind an `entering` class: the base
`.doc-list-divider` has no animation; Popup.tsx adds `entering` only when
the render is a real reorder, using a render-time mirror of the same test
(`activeDocs.some(d => prevTops.current.has(d.id))` — cards have position
history). Reading prevTops during render is safe: it's only written in the
layout effect, after render. Reduced-motion rule retargeted to `.entering`.

## Tasks (follow-up)
- [x] Popup.tsx — dividerMayAnimate render-time guard; divider gets `entering` class only on real reorders
- [x] popup.css — animation moved from .doc-list-divider to .doc-list-divider.entering
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified the .entering selector compiled into the content bundle

## Follow-up: History-card hover expansion given the same choreography (same session)

User: the hover expansion of History cards is sudden — wants it gentle like
the doc reorder. Two distinct abruptnesses found:

1. **No hover intent.** Expansion fired on the first frame the pointer
   touched a card, so merely moving the mouse ACROSS the list churned every
   grazed card open/closed. Added a 0.14s expand delay via
   `transition-delay` on the hover/focus/show-actions rule — deliberately
   EQUAL to REORDER_HOLD_MS so every motion in the drawer shares one
   "pause, then move" rhythm. Grazed cards now never move at all (a delayed
   CSS transition is cancelled outright if the value reverts before the
   delay elapses). Collapse got a shorter 0.1s forgiveness delay on the
   base rule, so grazing off the card edge and straight back doesn't flap.

2. **Border snap at onset.** `:hover` changes border-color on both
   .history-item AND .doc-item, but border-color was in neither card's
   transition list — the outline popped to full brightness on the same
   frame the smooth expansion began (the same "sharp change at the start of
   gentle motion" shape as the earlier opacity/box-shadow findings). Added
   border-color 0.2s to both.

## Tasks (follow-up)
- [x] popup.css — expand delay 0.14s (= REORDER_HOLD_MS) on the expanded-state rule, collapse delay 0.1s on the base rule
- [x] popup.css — border-color added to .history-item and .doc-item transitions
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified all three compiled into the content bundle

## Follow-up: slower, symmetric easing on the actions-row collapse (same session)

User asked for "the slow Ease animation kind of interaction" on the card
collapse — read as: reuse the genuinely slow-in/slow-out curve already
established (and numerically verified) for DocsTab's FLIP reorder,
`cubic-bezier(0.65, 0, 0.35, 1)`, instead of `.history-actions-row`'s
previous one-sided `cubic-bezier(0.33, 1, 0.68, 1)` (fast start, decelerate
only — reads as an abrupt snap on collapse). Duration bumped 0.24s → 0.28s
(and opacity's 0.18s → 0.22s) so the eased ends are actually perceptible on
a height change this small — a curve this symmetric needs a beat more time
to read as anything other than linear at a shorter duration.

## Tasks (follow-up)
- [x] popup.css — .history-actions-row transition swapped to cubic-bezier(0.65, 0, 0.35, 1), duration bumped slightly
- [x] tsc clean (only the 3 known pre-existing errors, CSS-only change) + build; verified the new curve compiled into the content bundle

---

# Lecture-timestamp clipping (2026-07-10)

Clips saved on a YouTube watch page carry the video moment they came from:
History's Source link reopens the lecture already playing at that moment,
and the Doc bullet gets a small caption-styled " · 43:21" link doing the
same — the Doc becomes a clickable index of the lecture.

## Design decisions
- **`videoTime` is its own field, never baked into sourceUrl.** sourceUrl
  doubles as the page's IDENTITY in five places (isNewArticle grouping,
  Works Cited dedup-by-source, archivedUrls keying, docCaptionBookmarks
  keying, reflection-nudge streaks) — a per-clip `t=` param would make every
  clip from one lecture look like a different page (heading re-emitted per
  clip, one bibliography entry per clip, etc.). The content script also
  CANONICALIZES the url on watch pages (strips t/start — a shared timed link
  would otherwise poison the identity too).
- **Transcript line beats playback time.** Each transcript segment carries
  its own timestamp in the DOM (`ytd-transcript-segment-renderer` →
  `.segment-timestamp`) — precise to the sentence and independent of where
  playback is paused while the student reads. Fallback: `video.currentTime`
  floored, ignored below 1s (a never-played video says nothing). Everything
  best-effort in try/catch — YouTube's DOM is theirs to change; failed
  detection = a normal untimed clip.
- **Captured when the toolbar appears, not when Save is clicked** — the
  selection (and its transcript line) may be gone by then. Quick-save
  (Cmd+Shift+S) captures at save time (selection is alive by definition).
- **Doc rendering:** clip line becomes `${text} · 43:21`; the suffix is
  styled like the caption (9pt, LINK_FG, no underline) and linked via
  `timedVideoUrl`. LinkSpan offsets are relative to the original text and
  the suffix sits after it — no adjustment needed; note/bookmark ranges all
  derive from clipEnd, which now uses clipText.length.
- **Source link:** timed URL replaces the text fragment for video clips (a
  fragment can't match a collapsed transcript panel).
- Scope: text clips only (images skipped); Notion untouched (hidden at MVP);
  youtube.com/watch only for now.

## Tasks
- [x] src/lib/video.ts — formatVideoTime, timedVideoUrl (shared by content/background/popup)
- [x] types.ts — SaveNoteMessage.payload.videoTime?, HistoryEntry.videoTime?
- [x] content/index.tsx — getVideoClipContext(range); threaded through toolbar save (captured at showToolbar) + quick save
- [x] background — videoStampRequest, appendToGoogleDoc clipText/suffix in both branches, handleSave threading + archive entry
- [x] Popup.tsx — sourceHref returns timed URL for video clips
- [x] CLAUDE.md — product description + HistoryEntry fields updated
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified transcript selectors + videoTime in content bundle, formatter + t-param builder in background bundle

## Status: DONE. Tested live by the user on a real YouTube page (2026-07-10)
— confirmed working. (The transcript-segment DOM selectors
`ytd-transcript-segment-renderer`/`.segment-timestamp` are YouTube's markup
and could still break if YouTube changes it; the failure mode is a silent
fall back to playback time, then to a normal untimed clip.)

---

# Add-document open/close now animates as height growth (2026-07-10)

User: cards under "Hidden from toolbar" jump instead of shifting smoothly
when the add-form opens. Diagnosis: three elements were on three different
clocks — the form popped in at FULL height on one frame (a conditionally-
mounted element can't be CSS-transitioned open; no "before" state exists),
the divider teleported (never a FLIP participant), and the cards held 140ms
then slid, briefly overlapping the already-full-size form. FLIP was the
wrong tool for an INSERTION.

Fix: the trigger button and the form are now permanently co-mounted inside
one `.add-control` wrapper, each in a reciprocal 0fr↔1fr grid collapse
(History's action-row trick) on the same 0.4s/house-curve clock — the button
shrinks as the form grows, producing ONE smooth net height change that the
divider and cards below simply ride via ordinary layout. Works in both
directions (Cancel animates closed for free). FLIP stays out of it: at
measurement time the transition hasn't progressed, dy≈0, correctly no-op.
Details: `visibility` flips hidden 0.4s AFTER collapse (tab-order/a11y
without vanishing mid-animation); inner grid items carry no padding
(border-box floor, same as .history-actions-inner); `autoFocus` replaced
with an explicit focus-on-open effect (the input never remounts now);
cn-add-reveal keyframes kept only for the divider's `.entering`; the FLIP
participant ref moved to the never-remounting-on-open wrapper.

- [x] Popup.tsx — addControl restructure, addInputRef + focus effect
- [x] popup.css — .add-collapse/.add-collapse-inner + reduced-motion; .add-form mount animation removed
- [x] CLAUDE.md — "insertions animate as height growth, not FLIP" invariant added
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified add-collapse/add-control compiled into the bundle

## Follow-up: morph re-timed after user feedback — "keep it simple and minimal"

The 0.4s slow-in/slow-out double-morph felt heavy for a form-open. Lesson
captured as a CLAUDE.md invariant: two motion registers — the slow
symmetric curve + hold is for SYSTEM-initiated rearrangement (reorders);
direct user commands respond fast. The co-mounted-collapse plumbing stays
(that's what keeps content below smooth); only the timing changed: 0.22s
`cubic-bezier(0.16, 1, 0.3, 1)` ease-out (the curve cn-add-reveal already
used), opacity 0.15s, no delays.

- [x] popup.css — .add-collapse timing swapped to fast ease-out
- [x] CLAUDE.md — "two motion registers" invariant added
- [x] build; verified 0.22s compiled into the bundle

---

# CLAUDE.md brought current + History-card padding fix (2026-07-09)

**CLAUDE.md update (on request):** manifest note now lists the 3 AI host
permissions; product description covers Works Cited + BYO-AI + Someday
removal; Background lists AI provider calls; drawer view state machine
documented ('main'|'privacy'|'trust'|'ai' + the ✨ AI header button);
message-flow diagram gains UPDATE_BIBLIOGRAPHY / CONNECT_AI / DISCONNECT_AI /
ASK_FOLLOWUP / SUMMARIZE_TOPIC; storage table gains worksCitedBookmarks +
aiConfig (with the local-not-sync reasoning); two new sections (BYO-AI layer
with the anthropic-dangerous-direct-browser-access + error-body + Claude-Pro≠API
gotchas; Works Cited delete-then-rebuild pattern); FLIP section rewritten as
an invariants list (fill:'backwards', interruption continuity, guarded
cleanup, participants incl. add control, data-arriving-is-not-movement,
will-change, shared hover rhythm).

**Padding fix (user screenshot: card bottom padding > top).** Root cause:
the 0fr-grid collapse trick can't collapse PADDING — with the global
border-box, an element's height never shrinks below its own padding, so
.history-actions-inner's at-rest `padding: 16px 0 2px` left an invisible
~18px band under every card's meta. Card padding was symmetrical (12px) all
along; the band made the bottom read as ~30px. Fixed: inner padding is 0 at
rest, applied only in the expanded state, transitioned on the same
clock/curve/delays as the row (and disabled under reduced motion). Gotcha
added to CLAUDE.md's motion invariants.

- [x] CLAUDE.md — all sections above
- [x] popup.css — inner padding state-switched + reduced-motion + comments
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified padding:0 compiled into the bundle

---

# Soft Triage / Someday — REMOVED (2026-07-09, user: "I don't like it")

Full deletion, not a pause: Someday header filter + count, per-card "Mark as
Someday" menu item, the "still relevant?" triage check-in card,
toggleSomeday/pickTriageCandidate/dismissTriageForToday/TRIAGE_MIN_AGE_MS,
HistoryEntry.someday, triageDismissedDay storage read/write, all .triage-*
CSS, and someday exclusions inside pickResurfaced/suppression conditions.
The .someday-filter pill CSS survives renamed as the general .header-pill
(the Filter trigger was already reusing it). MdSchedule import dropped
(unused). Stored data untouched: stale `someday: true` fields and
`triageDismissedDay` may linger, simply unread — previously-hidden Someday
clips reappear in the main History list. CLAUDE.md + docs/ROADMAP.md updated
to match.

- [x] Popup.tsx / types.ts / popup.css — all of the above
- [x] CLAUDE.md storage table + HistoryEntry fields + card-padding list updated
- [x] docs/ROADMAP.md — #4 struck through with a removal note; Resurfaced re-enable snippet updated (no more showSomedayOnly)
- [x] tsc clean (only the 3 known pre-existing errors) + build; verified zero someday/triage strings and 2 header-pill occurrences in the content bundle

---

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

---

# Voice-note capture at clip time (docs/IDEAS.md #1)

Hold/click a mic button in the toolbar's note panel and speak a margin note
instead of typing it — transcribed via the Web Speech API. Chosen from a
fresh 5-idea creative brainstorm (docs/IDEAS.md) as the first to build.

## Why not a direct content-script call

Calling `SpeechRecognition`/`getUserMedia` directly from the Toolbar (a
content script) would trigger a mic-permission prompt scoped to *whatever
website the user is currently on* ("nytimes.com wants to use your
microphone") — asked again per new domain, and silently blocked outright on
any site with a restrictive Permissions-Policy header.

## Two architectures tried — only the second one actually works, confirmed live

**First: `chrome.offscreen` (built, shipped, then fully reverted).** The
documented fix for "request a permission scoped to the extension's own
origin" is `chrome.offscreen` (`reasons: ['USER_MEDIA']`). Failed on the
first live test: "Microphone permission was denied," instantly, no prompt
shown. Researched rather than guessing again — confirmed via the Chromium
extensions mailing list and multiple GitHub issues that offscreen documents
have no visible surface for Chrome to anchor a `getUserMedia` prompt to, a
hard platform restriction. Built the natural next fix — a *separate* real
tab (`src/permission/`) whose only job was triggering the dialog, then
letting the offscreen doc use the mic afterward (same extension origin).
Tested live: the permission step itself worked (native dialog appeared,
"Microphone in use" indicator lit up) — but the offscreen document still
couldn't use the microphone afterward. No source could be found confirming
an offscreen document can *ever* successfully call `getUserMedia`, granted
or not. Abandoned entirely rather than patched a third time —
`src/offscreen/` and `src/permission/` no longer exist.

**Second, current: a real, visible tab does the recognition itself.** The
one thing proven to work end to end is a real tab — so recognition now
happens right there. `src/voice/index.html` + `index.ts`, opened via
`chrome.tabs.create` when the mic button is clicked: requests
`getUserMedia({audio:true})` on load (native dialog first time, instant
resolve every time after, since the grant is scoped to the extension's
stable origin), then immediately starts `SpeechRecognition` for as long as
the tab stays open.

## Message flow (current)

A real tab has an actual id, so `chrome.tabs.sendMessage` can target it
directly — no broadcast-collision risk to design around on that leg, unlike
the abandoned offscreen version where every hop needed a uniquely-named
message type to avoid `chrome.runtime.sendMessage`'s broadcast-to-everyone
behavior colliding with itself.
- `START_VOICE_NOTE` — Toolbar → background. Background opens the voice tab,
  tracks `voiceSession: {originTabId, originFrameId, voiceTabId}` in a plain
  in-memory variable (fine for a live-streaming interaction — if the service
  worker is killed mid-recording, that one session just stops).
- `VOICE_RECOGNITION_EVENT` — voice tab → background. Checks
  `sender.tab?.id === voiceSession.voiceTabId` — a real tab always has a
  `sender.tab`, unlike the old offscreen doc, so this is about matching the
  *right* tab, not detecting the absence of one.
- `VOICE_NOTE_UPDATE` — background → Toolbar, via `chrome.tabs.sendMessage`
  with the origin's exact `{tabId, frameId}`.
- `STOP_VOICE_NOTE` — Toolbar → background → `VOICE_TAB_STOP` sent directly
  to `voiceSession.voiceTabId`.
- `chrome.tabs.onRemoved` also ends the session if the voice tab closes any
  other way (user closes it manually, or it self-closes after an error).

**Returning focus to the origin tab is explicit, not left to Chrome.** A
live test surfaced this as its own bug: after the tab closed, Chrome
switched focus to some unrelated tab instead of back to the one the user
was working in, because the tab was opened from the background (no "current
tab" concept, so no real opener relationship for Chrome to fall back on).
Fixed by never relying on that — ending a voice session always calls
`chrome.tabs.update(originTabId, {active: true})` explicitly, regardless of
how the session ended.

**Transcript merging** still happens in the Toolbar, not the voice tab
(unchanged from the original design): `baseNote + (baseNote ? ' ' : '') +
sessionText`, replacing rather than appending the session portion each
update, since `onresult` re-fires with cumulative text each time.

**Failure modes, still explicit:** unsupported browser → mic button hidden
(feature-detected directly via `'webkitSpeechRecognition' in window`,
skipping a message round-trip); permission denied → the voice tab points at
the address bar's site-settings icon (Chrome won't re-show its prompt after
an explicit denial) and reports an error so the Toolbar reflects it too;
recognition ending on its own is treated like an explicit stop; a 90s safety
timeout force-stops a forgotten-open mic; Toolbar unmount mid-recording
sends `STOP_VOICE_NOTE`.

## Tasks
- [x] types.ts — VoiceEvent (transcript/error/ended), Start/StopVoiceNote,
      VoiceTabStop, VoiceRecognitionEvent, VoiceNoteUpdate
- [x] vite.config.ts — additionalInputs: ['src/voice/index.html']
- [x] manifest.json — no extra permission needed (offscreen permission
      removed along with the abandoned offscreen approach)
- [x] src/voice/index.html + index.ts — permission request + SpeechRecognition
      lifecycle + Listening/error UI, all in one real tab
- [x] background/index.ts — voiceSession tracking, START/STOP handlers,
      VOICE_RECOGNITION_EVENT relay (matched by voiceTabId), VOICE_TAB_STOP,
      chrome.tabs.onRemoved cleanup, explicit focus-return on session end
- [x] Toolbar.tsx — mic button in .note-foot, recording state, baseNote
      capture + merge on VOICE_NOTE_UPDATE, error text, feature-detection
      (unchanged from original design — this component didn't need to
      change across either architecture attempt)
- [x] tsc clean + build; verified dist/src/voice/ exists, dist/src/offscreen/
      and dist/src/permission/ no longer do, offscreen manifest permission
      removed, and expected identifiers compiled into all affected bundles
- [x] Voice tab's "Listening…" state visually verified via headless Chrome
      against its real HTML/CSS
- [ ] Live verification in Chrome (mic permission prompt, transcript
      accuracy, stop/resume) — needs a real microphone; not testable via
      headless automation. FULL reload required.

## Status: Architecture rebuilt after two live-test failures on the
offscreen-document approach. Type-checks, builds, and visually verifies
correctly. Still needs a full live pass with a real microphone to confirm
the actual recognition loop end to end — this is now the one open item.

## Follow-up: the voice tab shouldn't take over the user's view (same session)

First live test of the real-tab architecture confirmed transcription
genuinely works (screenshot showed live text: "my name is Sandeep Kumar
Singh") — the core mechanism is proven. But direct feedback: the user wants
to stay on the page they're clipping from and watch the note field fill in
live, not have their view taken over by a separate tab showing its own copy
of the transcript.

Fixed by opening the voice tab in the background (`active: false`) instead
of letting `chrome.tabs.create` default to focusing it. The wrinkle: a
backgrounded tab may not be able to show Chrome's native mic-permission
dialog at all, so the decision to foreground has to happen *before* calling
`getUserMedia`, not as a reaction to a prompt that might not even be able to
appear. The voice tab now checks `navigator.permissions.query({name:
'microphone'})` first; only if the state isn't already `'granted'` does it
ask the background to foreground it (`VOICE_TAB_NEEDS_FOREGROUND` →
`chrome.tabs.update(tabId, {active:true})`). In practice: one moment ever
where the user needs to look at this tab (the first grant, or a past
denial), everything after that is fully invisible.

- [x] types.ts — VoiceTabNeedsForegroundMessage
- [x] background/index.ts — chrome.tabs.create now passes active:false;
      new listener foregrounds the sender tab on VOICE_TAB_NEEDS_FOREGROUND
- [x] voice/index.ts — permissions.query check before getUserMedia, sends
      VOICE_TAB_NEEDS_FOREGROUND only when not already granted (defaults to
      foregrounding if the query itself fails, since that's the safer
      direction to err in)
- [x] tsc clean + build; verified active:false and the new message type
      identifier compiled into the background and voice-tab bundles

## Follow-up: the finishing interaction, researched from psychology first (same session)

User asked to step back before further fixes: research the interaction
psychology of "user starts speaking, text gets detected... how should
finishing work?" rather than just patching. Four changes came out of it.

**Auto-stop on a pause, not a second click.** `continuous` stays `true`
(mid-thought pauses shouldn't cut someone off), but a new silence-timeout
watcher in the voice tab stops recognition after a pause — matching the
pause-means-done model every voice assistant already trains people on
(Jakob's Law), rather than requiring an explicit stop click. Two
thresholds: `INITIAL_SILENCE_MS` (8s, time to start talking) and the much
shorter `PAUSE_SILENCE_MS` (1.8s, once they've spoken and gone quiet). A
`STILL_LISTENING_HINT_MS` timer updates the hint text if the initial window
drags on, distinguishing "quiet but working" from "broken" for the rare
case someone does see the tab.

**Auto-stopping the listening ≠ auto-saving.** The transcript sits in the
note field, editable, until a deliberate Enter/Save — voice transcription
is never perfectly accurate, and this project's error-prevention stance
(always leave a review beat before anything irreversible) argues against
auto-committing a clip on someone's behalf.

**Enter (or any save-triggering control) while still recording now means
"finish and save."** `handleSaveRequest` — used by the Enter key, "Save
with note," the main "Save to X" button, and the keyboard-nav Enter action,
every path that could trigger a save — checks `isRecording` first. If
still recording: sets `saveAfterStopRef`, stops recognition, and defers the
actual save until the real `'ended'` event confirms the final transcript
landed (guaranteed after any last final speech segment, per
`SpeechRecognition`'s own event ordering) — via `handleSaveRef.current()`,
a ref kept fresh every render rather than the message listener's stale
closure. Collapses two required actions into the one keystroke people
already use for a typed note.

**Real bug this surfaced: editing the note by hand mid-recording could get
silently overwritten.** The old merge logic replaced the *whole* note value
on every transcript update, from a snapshot taken at recording-start — so
manually fixing a mis-heard word would vanish on the next update. Fixed
with a "did anything change since our own last write" check (`noteValueRef`
vs `lastVoiceWriteRef`, both updated at every write site — textarea
`onChange` and the transcript handler — not derived from a `useEffect` that
could lag). Unchanged case: same fast-replace as before. Manual edit
detected: switches to *appending* just the new part of the session text
(best-effort prefix diff) after whatever's currently in the box, rather
than replacing it.

**Smaller fix, same pass:** dismissing the note panel any other way
(Escape, opening the destination dropdown) used to leave an active
recording running invisibly. A recording is now always tied to the panel
being open — closing it any way at all stops the mic too.

- [x] voice/index.ts — INITIAL_SILENCE_MS/PAUSE_SILENCE_MS/
      STILL_LISTENING_HINT_MS, resetSilenceTimer wired into onresult/start
- [x] Toolbar.tsx — noteValueRef/lastVoiceWriteRef/lastSessionTextRef for
      safe merge; saveAfterStopRef + handleSaveRef for deferred save-while-
      recording; handleSaveRequest used by every save-triggering control;
      showNote-watching effect stops a recording if the panel closes any
      other way
- [x] tsc clean + build; verified startsWith/endsWith (merge logic) and
      permissions.query/VOICE_TAB_NEEDS_FOREGROUND compiled into the
      content and voice-tab bundles respectively

## Status: Interaction redesigned around explicit psychological reasoning,
not just bug-fixed reactively. Type-checks and builds clean. The 1.8s
pause threshold is a reasoned starting point, not empirically tuned yet —
still needs a live pass to confirm it feels right in practice, alongside
the base feature's still-pending live microphone verification.

## Follow-up: Enter-while-recording sometimes didn't save at all (same session)

First live test: pressing Enter mid-speech sometimes did nothing. Real
race, not a repeat bug — Enter and the silence auto-stop can both be
triggered by the same "user stopped talking" moment, landing within
milliseconds of each other. If the background clears `voiceSession` (auto-
stop's own `'ended'` already processed) before the Toolbar's `isRecording`
re-renders, `handleSaveRequest` reads a stale `true`, sends a second
`STOP_VOICE_NOTE` that's now a no-op, and there's no second `'ended'` event
left to ever resolve `saveAfterStopRef` — the save waits forever.

Fixed with a 1.2s safety-timeout alongside the deferred-save flag, rather
than trying to perfectly synchronize two independently-timed async
triggers (the real state only exists behind message-passing, never
synchronously reachable). If nothing has cleared `saveAfterStopRef` by
then, save anyway with whatever's in `note` — safe regardless of how the
race actually resolves, since the last real transcript update always lands
well before this fires either way.

- [x] Toolbar.tsx — handleSaveRequest's deferred branch now also starts a
      1.2s fallback timer that force-saves if saveAfterStopRef is still set
- [x] tsc clean + build; verified the 1200 constant compiled into the
      content bundle

## Follow-up: clicking mic left focus stuck on the button itself (same session)

User feedback with a screenshot: the mic button visibly kept a focus ring
after being clicked, and pressing Enter afterward just toggled the mic on/
off again instead of saving. Root cause: clicking any `<button>` leaves it
holding DOM focus, and a browser's *default* behavior for a focused button
is to treat Enter as a click on that button specifically — not a page-wide
keystroke. `handleNoteKey` (with all the deferred-save logic from the two
follow-ups above) is only wired to the *textarea's* `onKeyDown`, so an
Enter press landing on the still-focused mic button never reached any of
that — it just re-triggered the mic button's own onClick.

Fixed by returning focus to the textarea right after handling the mic
click (both starting and stopping), mirroring a fix already in this exact
component: the pencil button that opens the note panel already does this
(`useEffect` on `showNote`). The mic button just hadn't gotten the same
treatment.

- [x] Toolbar.tsx — `noteRef.current?.focus()` after both branches of
      handleMicClick
- [x] tsc clean + build
