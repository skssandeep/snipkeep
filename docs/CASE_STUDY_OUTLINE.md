# SnipKeep — UX Design Case Study: Structure & Content Guide

A complete blueprint for writing the SnipKeep case study. Each section below
describes **what to write, which real artifacts to show, and what the reader
should walk away believing**. The raw material for every claim already exists
in this repo (`docs/ROADMAP.md`, `docs/FEATURES.md`, `tasks/todo.md`,
`CLAUDE.md`) — the case study's job is to curate it into a story, not to
invent anything.

**The one-sentence thesis to carry through every section:** *good UX for
learners is mostly restraint — the product's job is to disappear into the
user's own work (their Google Doc), never to trap them in ours.*

---

## 1. Hero / Snapshot

**Content:** Product name + wordmark, a single hero shot (the drawer open
over a real article, toolbar visible on a selection), and a one-liner:
"A Chrome extension that turns web reading into a research archive that
lives in the student's own Google Doc — no server, no lock-in."

**Metadata block:** your role (product designer + developer), timeline,
platform (Chrome MV3 extension), stack (React, Shadow DOM, Google Docs API),
and methods used (behavioral-psychology research, iterative live testing,
design tokens, motion design).

**Why it matters:** recruiters/readers decide in ~10 seconds here. The hero
must show the product *in situ* on a real webpage — the whole point is that
SnipKeep is a companion, not a destination.

---

## 2. TL;DR — Outcomes First

**Content:** 4–6 bullet outcomes, each one line. Draw from:
- 8 research-backed features shipped; **2 deliberately killed after
  evaluation** (lead with this — honesty is the differentiator).
- A design system with **numerically verified accessibility** (every token
  contrast ratio computed, not eyeballed — e.g. the accent-soft fill capped
  at 0.18 alpha because 0.22 fails WCAG AA at 4.42:1).
- Zero-backend architecture as a *UX* decision (privacy = trust = adoption).
- AI integrated under a hard philosophy: **it may classify and ask — it may
  never do the student's thinking.**

**Guidance:** No process talk here. Only results and stances.

---

## 3. The Problem — The Collector's Fallacy

**Content:** Define the core insight in plain language: *saving feels like
learning, but it isn't.* Students highlight, bookmark, and hoard — then never
return. Existing tools make this worse: they optimize for capture volume and
lock the archive inside their own app, so the pile grows where the student
never looks.

**Show:** a simple "the pile" illustration or a before-state storyboard
(20 open tabs, a bookmarks folder named "thesis stuff", a blank essay doc).

**Reader takeaway:** the enemy isn't friction — it's *false productivity*.
Every later design decision (reflection nudge, margin notes, no-shame
mechanics) traces back to this one insight, so state it memorably.

---

## 4. Who It's For

**Content:** One primary persona — the student researcher writing essays and
studying from articles and lecture videos. Describe their real workflow
(gather → quote → cite → cram) and their two fears: losing their sources, and
plagiarizing by accident. Skip fake demographic details; focus on behaviors
and jobs-to-be-done ("when I find a good quote, I want it captured with its
provenance so citing it later is free").

**Guidance:** One persona done deeply beats three done shallowly. A short
"a week in their research" timeline works better than a persona card.

---

## 5. The Product Thesis & Design Principles

**Content:** The load-bearing section. State the architecture-as-UX position:

1. **The Google Doc is the real product.** SnipKeep is just how content got
   there. If SnipKeep vanished tomorrow, nothing is lost. (Show the Trust
   Card UI — it literally says this to the user.)
2. **No server, ever.** Everything lives in the user's Doc or on-device.
   Privacy isn't a policy, it's an architecture. (Show the Privacy Ledger —
   a literal account of what leaves the device, with one honest red ✕:
   "A SnipKeep server — there isn't one.")
3. **No shame mechanics.** No streaks, no guilt, no delete-if-unread
   countdowns. Every nudge is zero-consequence to ignore.
4. **Invisible by default.** Features earn their pixels; anything optional
   renders nothing until opted into (the AI layer is literally absent from
   every menu until a key is connected).

**Reader takeaway:** these four principles later *decide arguments* — the
case study should show them being used as tiebreakers, not as posters.

---

## 6. Research → Roadmap

**Content:** Describe the research pass that produced the feature roadmap:
surveying learning-science and behavior-change literature (testing effect,
generation effect, spaced exposure) and competitor patterns (including the
punitive ones deliberately rejected — e.g. delete-if-unread mechanics), then
converting it into a ranked, buildable roadmap with an explicit ground rule
list. Reproduce the actual ground rules from `docs/ROADMAP.md` (never let
investment become lock-in; no punitive mechanics; no new backend unless the
user brings their own credentials; invisible by default).

**Show:** the roadmap table itself — including the strikethrough rows. A
roadmap with visible kills is more credible than a clean one.

---

## 7. Design System — Small, Strict, Verified

**Content:**
- **Color:** warm-near-black surfaces, one electric-violet accent, semantic
  `--danger`/`--warn` kept separate from the accent. The star exhibit: the
  accent-tint story — `--accent-soft` at exactly 0.18 alpha because the
  contrast of accent text on it computes to 4.8:1, while 0.22 drops to
  4.42:1 and fails WCAG AA. **Show the math.** This one paragraph proves the
  system is engineered, not curated.
- **Type & spacing:** 4-tier type ramp with WCAG-locked grays; 4px spacing
  grid; the "never stack a child margin on a parent gap" rule and the real
  double-spacing bug that created it.
- **Icons:** the migration from mixed emoji (inconsistent per-OS, colorful
  against a monochrome UI) to a tree-shaken Material icon set — with the
  bundle-size receipt (~8.7KB for the entire sweep).

**Show:** a token sheet, the History card anatomy annotated, before/after of
emoji → icons.

---

## 8. Core Flows (the walkthrough)

**Content:** Three end-to-end flows, each as annotated screenshots or short
clips:

1. **Capture:** select text → floating toolbar → save. Cover the layers of
   capture depth: bare clip, margin note ("your take"), voice note (speak the
   note instead of typing — with the psychology-first finishing interaction:
   silence auto-stops *listening* but never auto-*saves*; a review beat is
   always preserved), keyboard-first path (Enter to save, ↵ badge teaching
   the shortcut), preserved hyperlinks, right-click image capture.
2. **The Doc as artifact:** what actually lands in Google Docs — heading per
   article, grey provenance caption, bulleted quotes, italic violet margin
   notes, the auto-maintained Works Cited section, archive links, lecture
   timestamps. Full-page screenshot of a real research Doc. This is the
   money shot of the whole study: *the deliverable is theirs, not ours.*
3. **Revisit & cite:** History with full-text search, #tag chips, per-clip
   Cite (style picked at the moment of citing — the persistent APA/MLA strip
   was removed because most users never cite; explain that reasoning),
   deadlines with calm→warn→danger escalation, the Completed tab.

**Guidance:** annotate *decisions*, not features ("the toolbar is
keyboard-drivable but never hijacks native selection keys — deliberately out
of scope, here's why").

---

## 9. Feature Deep-Dives (pick 4, tell each as a story)

Each deep-dive follows the same beat: **user problem → options considered →
principle that decided it → what shipped → what was learned.** Strongest
candidates:

- **Works Cited, auto-maintained.** From per-clip citations to a live
  deduplicated, alphabetized bibliography at the Doc's end. Include the
  rebuild-don't-append reasoning and the live-tested bug: re-citing in a new
  style didn't update the Doc — and the fix made the whole list
  style-consistent, better than the naive patch.
- **Lecture-timestamp clipping.** Students learn from YouTube; a clip from a
  lecture now deep-links back to the exact minute. Include the architectural
  trap avoided (timestamp kept out of the URL because the URL doubles as page
  identity for grouping/dedup/archiving) — a great example of invisible
  design work.
- **Voice notes.** Two failed architectures (offscreen documents can never
  get mic permission — confirmed live, twice) before the real-tab solution,
  and the interaction design pass: pause-means-done, Enter-while-recording
  means finish-and-save, the manual-edit-mid-recording clobbering bug.
- **BYO-AI layer.** The philosophy first (from the PACER critique: AI
  classifies and asks questions; it never writes the reflection — doing the
  student's digestion for them defeats the learning), then the trust design
  (key validated against a free endpoint, stored device-local, feature
  invisible until connected), then the live-debugging story (generic "key
  rejected" error → reading the provider's real error body → the
  browser-access header; and the "Claude Pro ≠ API credit" user confusion,
  which is itself a UX finding).

---

## 10. Motion & Microinteraction Craft

**Content:** The strongest "craft depth" section, told as an iterative saga
on one interaction (toggling a doc card):

- Easing verified **numerically**: Material's standard curve reaches ~24%
  progress by 25% of duration — near-linear in practice despite its zero
  tangent; the chosen curve reaches ~7%. Show the two curves plotted.
- The `fill: 'backwards'` bug — a delayed Web Animation with `fill: 'none'`
  renders "jump to end → hold → jump back → slide": the fix that finally
  killed the "sudden jerk" after two plausible-but-wrong fixes. Honest
  sequencing of *wrong fixes first* makes this section.
- **"Data arriving is not movement"** — the ghost-slide bugs on drawer open
  (async storage load animated as if it were a reorder) and the guard that
  encodes the principle.
- **Two motion registers** — the final user feedback ("keep it simple and
  minimal") produced the rule: slow symmetric curves for *system-initiated*
  rearrangement; fast ease-out for *direct user commands*. A user-invoked
  control on the reorder clock reads as laggy, not gentle.
- Hover-intent delays on card reveals (grazed cards never move) and the
  border-box/0fr padding floor bug ("bottom padding is bigger than top").

**Show:** short screen recordings, before/after; the invariants list from
CLAUDE.md as a closing artifact.

---

## 11. Designing by Subtraction (killed & paused features)

**Content:** The section most case studies lack. Three exhibits:

- **Topic Auto-Clustering — built, then deleted.** At realistic archive
  sizes the chips carried no signal (a domain chip covering ~100% of clips
  filters to "everything"); the value was already served by inline #tags.
  Keep the one salvaged capability: search matching source URLs.
- **Soft Triage / "Someday" — shipped, then fully removed on user feedback**
  ("I don't like it"). What the removal taught: features that add standing
  UI and bookkeeping lose; features that live inside existing actions win.
- **✨ Resurfaced — paused, not deleted**, and why that's a different verdict
  than the other two.

**Reader takeaway:** the roadmap table's strikethroughs are the proof of a
real evaluation loop, not a feature factory.

---

## 12. Iterating on Live Feedback

**Content:** A rapid-fire sequence of real user-reported issues, each with
the screenshot that reported it, the root cause, and the fix — chosen to show
*diagnostic* skill, not just responsiveness:

- "Copied ✓" feedback was invisible — the Cite dropdown closing moved the
  cursor onto the next card, collapsing the hover row before the feedback
  could render. Fixed with state-pinned visibility, not a longer timeout.
- The asymmetric card padding that was actually an invisible collapsed-row
  padding floor.
- "Why did my citation get replaced?" — it didn't; dedup-by-source was
  working as designed, and the resolution was an *explanation*, not a code
  change. (Include this one deliberately: knowing when the design is right
  and the mental model needs a bridge is a UX skill.)

---

## 13. Accessibility & Trust

**Content:** Consolidate what's scattered elsewhere: WCAG-verified contrast
on every text tier and fill; keyboard operability of every interactive
element (and the invalid-HTML nested-button bug found by diffing the parsed
DOM against the JSX); `prefers-reduced-motion` honored across every
animation including the mount-gated ones; focus-visible rings everywhere.
Then the trust surfaces as designed objects: Privacy Ledger, Trust Card,
undo-over-confirm philosophy (reversible deletes with a 6s undo bar;
blocking confirms reserved for real blast radius).

---

## 14. Results, Reflection & What's Next

**Content:**
- **Results:** frame honestly for a personal project — shipped scope,
  features validated live, the working end-to-end artifact. If real usage
  numbers exist by writing time, add them; otherwise don't fake proxies.
- **What I'd do differently:** e.g., establish the motion invariants before
  the animation work instead of excavating them bug by bug; test the
  triage/Someday concept with users before building it.
- **What's next:** Closed-Book Revisit — retrieval practice triggered by
  organically revisiting a previously-clipped page (the testing effect,
  ambushing the exact moment students default to re-reading). Present it as
  a designed-but-unbuilt concept with its own critique (interruption risk,
  the no-shame constraint on the reveal).

---

## 15. Appendix (optional, for the deep reader)

Process artifacts: the ground-rules list verbatim; the motion invariants
list; a sample of `tasks/todo.md` showing the design-reasoning-per-task
working style; the PACER/adjacent-product critique as an example of scoping
discipline (knowing what *not* to bolt onto the product).

---

## Production Notes (for writing it)

- **Voice:** first person, decisions over descriptions. Every screenshot
  caption states a *why*, never a *what*.
- **Length target:** 8–12 minutes reading time. Sections 5, 9, 10, 11 carry
  the weight; compress 1–4 ruthlessly.
- **Visuals to produce:** hero in-situ shot; the annotated Doc artifact;
  token/contrast math graphic; two easing curves plotted; 3–4 short motion
  recordings; before/after pairs for section 12; the roadmap table with its
  strikethroughs.
- **The differentiators to protect** (if cutting, cut around these): the
  architecture-as-UX thesis (§5), designing by subtraction (§11), the motion
  saga with wrong-fixes-first honesty (§10), and the AI philosophy (§9).
