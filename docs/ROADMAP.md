# SnipKeep — Roadmap Status

Source of truth for **what's shipped, what's next, and why** — derived from a competitor + behavioral-psychology research pass (`research/SnipKeep-Competitive-Psychology-Report.pdf`, full HTML source alongside it). See `docs/FEATURES.md` for how each shipped feature actually works, and `CLAUDE.md` for core architecture.

## The core thesis (from the research report)

Every read-later/clipper competitor (Pocket, Omnivore) stores your archive in a database *they* control — both died in the last 18 months, taking users' archives with them. SnipKeep writes straight into a Google Doc the user already owns; there is no SnipKeep server. That's the structural, hard-to-copy trust advantage the whole roadmap is built to make visible and to protect (see "Investment must never become lock-in" below).

## Shipped (8 of 11 report features)

| # | Feature | One-line |
|---|---|---|
| 1 | **Privacy Ledger** | Honest, literal account of what leaves the device (drawer → avatar → 🔒 Privacy) |
| 2 | **Trust Card** | "Your Doc is the real thing" — shown once, right after the first doc is added, with a real link to it |
| 3 | **Link-Rot Insurance** | Best-effort Wayback Machine snapshot at save time, written back into the Doc next to the caption |
| 4 | **Soft Triage** | ~~Optional "Someday" tag + "still relevant?" check-in~~ — **removed 2026-07-09** (user: "I don't like it"; see note below) |
| 5 | **Gentle Reflection Nudge** | Soft one-liner after several note-less clips from the same article — targets the collector's fallacy |
| 6 | **Deadline-Aware Citations** | A Doc can carry a due date; calm→warn→danger countdown + uncited count; custom calendar picker |
| 7 | **Assignment/Project Mode** | Mark a Doc "done" → moves to its own **Completed** tab; excluded from proactive pickers, still findable |
| 8 | **Living Resurface** | "+ Add a note" writes a freshly dated note back into the Doc at any bookmarked clip's exact spot |

**#10 — Topic Auto-Clustering was built, then removed** (2026-07-06, user decision after a UX critique). It showed tag/domain chips above History's search box that dropped a query into search on click. Removed — not paused, fully deleted (`pickTopicClusters`/`extractTags`/`.topic-*` all gone) — for two reasons: (1) at realistic archive sizes the chips carried no signal (a domain chip covering ~100% of clips filters to "everything"; a just-applied tag reveals nothing), violating progressive disclosure; (2) the recognition/browse value it aimed at is already served inline — every `#tag` on a card is a clickable filter and each card shows its source domain, so the chips largely duplicated an existing affordance. The one keeper from that work: History's search now also matches `sourceUrl`, so typing a domain (e.g. `nytimes.com`) filters by site — an independently useful capability, retained. If clustering is ever wanted again, it belongs at real scale with a hard "must actually discriminate" gate, not shown unconditionally.

Plus, pre-roadmap (built earlier the same session, before the research pass): the **ClipNote → SnipKeep rebrand**, **margin notes**, **keyboard-first toolbar**, **link preservation**, **right-click image capture**, **living archive + full-text search**, **history navigation** (↗ Source / 📄 Doc / ⧉ Cite), **auto-citation**, and a **sign-out bug fix** + **#tag filtering**.

**#4 — Soft Triage was removed** (2026-07-09, user decision — "I don't like it"). Fully deleted, not paused: the Someday header filter, the per-card "Mark as Someday" menu item, the "still relevant?" triage check-in card, `toggleSomeday`/`pickTriageCandidate`/`dismissTriageForToday`, the `HistoryEntry.someday` field, and all `.triage-*`/`.someday-filter` CSS (the pill style survives as the general `.header-pill`, used by the Filter trigger). Stored data was left untouched: old clips may still carry a stale `someday: true` and `triageDismissedDay` may linger in storage.local — both simply unread now, so previously-hidden Someday clips reappear in the main History list.

**✨ Resurfaced is paused, not removed** (2026-07-06, user request — "keep it for future, not required for now"). `pickResurfaced` in `Popup.tsx` is fully intact and documented; `History()` just hardcodes `const resurfaced = null` instead of calling it, which skips both the computation and the JSX (gated on `resurfaced &&`) in one line. To re-enable: restore `const resurfaced = q ? null : pickResurfaced(activeEntries)`. Everything downstream (Living Resurface's "add a note" on any bookmarked clip) already tolerates `resurfaced` being `null` — nothing else needs to change.

## Not yet built (2 remaining — both explicitly deferred by user choice, not skipped for cause)

Of the report's buildable-without-a-backend features, all were shipped; #10 was then removed after evaluation (see above). The two below were explained in full and deliberately set aside by the user (2026-07-06) — treat this as "later," not "no":

- **#9 — Weekly Synthesis Digest.** An opt-in, once-a-week in-drawer view clustering that week's clips by tag/source, ending with an open-ended prompt rather than a summary — the "reward" half of the Hook Model loop that's still thin. A backend-dependent emailed version is a natural v2, not required for v1.
- **#11 — Anonymous Aggregate Highlight Signal.** "14 people also highlighted this passage" — opt-in, no-account, anonymized. **Needs real backend infrastructure and a security/privacy review before it should ship at all** — the one feature in the whole report that isn't client-only or talking directly to Google/archive.org with the user's own credentials. Deferred specifically because it's a different *category* of work (real infra + a privacy review), not just another feature pass.

**When resuming either:** don't re-explain from scratch — both were already walked through in detail with the user; check this file and `docs/FEATURES.md` for what's already decided before re-deriving the design.

## Ground rules for anything built after this point

1. **Never let "investment" become lock-in.** Notes, tags, citations, deadlines — all of it stays in the user's own Doc or local device storage, never in a SnipKeep-only database they can't take with them. This is the entire thesis; breaking it anywhere undoes the roadmap's point.
2. **No punitive/shame mechanics.** Soft Triage and the Reflection Nudge are both explicitly zero-consequence by design (ignoring them does nothing) — this was a deliberate rejection of Burn 451's delete-if-unread approach, based on the research showing streak-pressure UX is falling out of favor. Keep that stance.
3. **Feature #11 is the one exception to "no backend"** — treat it with real caution (opt-in, anonymized, audited) if it's ever built, given the current climate around AI-extension data harvesting documented in the research report.
4. **Every feature so far defaults to invisible/zero-friction** for a user who doesn't touch it. Preserve that when adding #9/#10.

## Process notes for future sessions

- Every feature in this doc was **type-checked** (`./node_modules/.bin/tsc --noEmit` — not `npx tsc`, which can resolve to an unrelated registry package; use the local binary directly) and **built** (`npm run build`) before being called done, and where the change was visual, verified with a real headless-Chrome screenshot against the actual shipped `popup.css` and font — not a guess.
- `npm run build` does **not** type-check (esbuild strips types silently) — see `CLAUDE.md`'s Commands section for the known pre-existing tsc errors to ignore.
- The Bash tool's working directory has drifted mid-session more than once in this project — `cd` explicitly and confirm with `pwd` in the same command rather than trusting persistence across calls.
