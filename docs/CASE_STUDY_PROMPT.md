# How to use this file

Copy **everything below the horizontal rule** into Gemini as a single prompt.
It is self-contained: Gemini cannot see this repo, so the prompt carries the
full ground-truth facts pack — every claim the case study needs is stated
inside it, and the rules forbid inventing anything beyond it.

---

## ROLE

You are a senior UX designer and portfolio writer. You write case studies
that read like a designer thinking out loud — decisions over descriptions,
first person, honest about failures, specific with numbers. You never pad,
never use portfolio clichés ("delightful", "seamless", "pain points"), and
never invent facts.

## TASK

Write the complete, publication-ready UX design case study for **SnipKeep**,
a Chrome extension I designed and built solo. Output it as one Markdown
document following the STRUCTURE section exactly. Everything you state must
come from the FACTS PACK below — it is the only source of truth.

## HARD RULES

1. **Never invent** metrics, user counts, dates, quotes, research citations,
   or A/B results. This is a solo personal project validated through live
   iterative testing with one primary user; frame results honestly that way.
2. Where an image belongs, insert a placeholder on its own line:
   `[SCREENSHOT: <exact description of what to capture>]` — and give every
   placeholder a caption that states a *why* (a decision), never a *what*.
3. Voice: first person ("I chose… because"), plain language, short
   paragraphs. Explain any technical term the first time it appears in one
   clause.
4. Length: an 8–12 minute read. Sections 5, 9, 10, and 11 carry the most
   weight; keep sections 1–4 tight.
5. The thesis to thread through every section: *good UX for learners is
   mostly restraint — the product's job is to disappear into the user's own
   work (their Google Doc), never to trap them in ours.*
6. When the FACTS PACK includes exact numbers (contrast ratios, durations,
   curve values), use them — precision is the credibility of this study.
7. Do not add sections, do not reorder, do not skip the failure stories.

## STRUCTURE (follow exactly)

1. **Hero / Snapshot** — product one-liner, my role (product designer +
   developer, solo), platform, stack, methods. One hero image placeholder
   showing the product in-situ on a real article.
2. **TL;DR — outcomes first** — 4–6 one-line outcomes; lead with the fact
   that 2 shipped features were deliberately killed after evaluation.
3. **The Problem — the collector's fallacy** — saving feels like learning
   but isn't; existing tools optimize capture volume and lock archives in
   their own apps.
4. **Who it's for** — one persona, behavior-based (student researcher),
   their workflow and two fears (losing sources; accidental plagiarism).
5. **Product thesis & design principles** — the four principles, presented
   as tiebreakers that later decide arguments.
6. **Research → roadmap** — the learning-science research pass, the ground
   rules, and the roadmap with visible kills.
7. **Design system — small, strict, verified** — the numerically verified
   tokens, spacing grid, icon migration.
8. **Core flows** — capture; the Doc as the artifact; revisit & cite.
9. **Feature deep-dives** — exactly four stories: Works Cited, lecture
   timestamps, voice notes, BYO-AI. Each: user problem → options →
   deciding principle → what shipped → what I learned.
10. **Motion & microinteraction craft** — the toggle-reorder saga told
    honestly, wrong fixes first.
11. **Designing by subtraction** — the two killed features and one paused
    feature, with reasons and lessons.
12. **Iterating on live feedback** — three diagnostic stories, including
    the one where the fix was an explanation, not a code change.
13. **Accessibility & trust** — verified contrast, keyboard, reduced
    motion, and the trust surfaces as designed objects.
14. **Results, reflection & what's next** — honest framing; what I'd do
    differently; the Closed-Book Revisit concept with its own critique.
15. **Appendix** — the ground rules verbatim; the motion invariants list.

## FACTS PACK (the only source of truth)

### What SnipKeep is
- Chrome extension (Manifest V3, React, Shadow DOM, Google Docs API).
- Select text on any webpage → a floating toolbar appears → one click saves
  the selection into a Google Doc the user chose. A right-side drawer
  manages destination Docs and a searchable clip history.
- There is **no SnipKeep server or database**. Every clip lives in the
  user's own Google Doc; history/settings live on-device (Chrome storage).
- Renamed from "ClipNote" to "SnipKeep" mid-project.

### The four principles
1. **The Google Doc is the real product** — SnipKeep is just how content got
   there. If SnipKeep disappeared tomorrow, nothing is lost. A one-time
   "Trust Card" UI says this to the user directly, with a live link to
   their Doc.
2. **No server, ever** — privacy as architecture, not policy. A "Privacy
   Ledger" screen gives a literal account of what leaves the device: three
   green checks (clip → user's own Docs API via their own Google sign-in;
   archive stays on-device; settings sync via Chrome's own sync) and one
   honest red ✕: "A SnipKeep server — there isn't one. Nothing to breach,
   nothing to sell."
3. **No shame mechanics** — no streaks, no guilt, no delete-if-unread
   countdowns (a rejection of punitive competitor patterns). Every nudge is
   zero-consequence to ignore.
4. **Invisible by default** — optional features render nothing until opted
   into. The AI layer is literally absent from every menu until the user
   connects a key.

### The problem & persona
- Core insight: the **collector's fallacy** — saving feels productive but
  isn't learning. Students highlight and hoard, never return, and their
  archive lives inside a tool they never reopen.
- Persona: a student researcher writing essays and studying from articles
  and lecture videos. Jobs: gather → quote → cite → revise. Fears: losing
  sources; accidentally plagiarizing.

### Capture features (as shipped)
- Floating toolbar on selection; keyboard-first: Enter saves, ←/→ move the
  highlight between actions, Esc dismisses; an ↵ badge on Save teaches the
  shortcut; native selection keys are deliberately never hijacked.
- **Margin notes** ("your take"): a pencil toggle opens a note panel; the
  note renders in the Doc as an indented, italic, muted-violet sub-line —
  visually "the reader's own voice" vs the verbatim quote.
- **Voice notes**: speak the margin note instead of typing. Architecture
  took three attempts: Chrome's offscreen documents can never obtain mic
  permission (confirmed by live testing twice, including a permission
  pre-grant attempt) — final design runs speech recognition in a real
  background tab. Interaction design: silence auto-stops *listening*
  (1.8s pause once speaking; 8s initial window) but never auto-*saves* —
  a review beat is always preserved because transcription is imperfect;
  pressing Enter while still recording means "finish and save"; a bug where
  manually correcting a mis-heard word mid-recording got clobbered by the
  next transcript update was fixed by switching to append-mode when a
  manual edit is detected.
- Hyperlinks inside the selection are preserved as real links in the Doc;
  right-click saves images.
- Quick save: Cmd/Ctrl+Shift+S saves the selection to the default Doc with
  a toast, no toolbar.

### The Doc as artifact (what a save produces)
- New article → an H2 heading (page title), a small grey caption
  "domain · date" with the domain hyperlinked, then bulleted quotes.
  Subsequent clips from the same article append as bullets under the same
  heading (no duplicate headings).
- Margin notes as indented italic violet sub-lines; " · archived" links
  appear next to captions once a Wayback Machine snapshot exists
  (**Link-Rot Insurance**: best-effort snapshot requested at save time,
  written back into the Doc later via a Google Docs NamedRange bookmark —
  so the safety net survives even if SnipKeep is uninstalled).
- **Living Resurface**: any clip can receive a freshly dated "↳ (Jul 10)
  …" note written back into the Doc at that clip's exact spot, via the
  same bookmark primitive.
- **Works Cited** section auto-maintained at the Doc's end (see deep-dive).
- **Lecture timestamps** as " · 43:21" links on video clips (see deep-dive).

### Revisit & cite features
- History: full-text search (also matches source URLs, so typing a domain
  filters by site), #tags in notes become clickable filter chips, filter by
  destination Doc (only offered once ≥2 docs exist — progressive
  disclosure).
- Per-clip actions revealed on hover: Source (deep-links with a text
  fragment so the browser highlights the quote on the original page), Doc,
  Cite, and an overflow menu.
- **Citation style is picked at the moment of citing** (APA / MLA /
  BibTeX). An earlier persistent "Cite as" strip was removed: most users
  never cite, so academic jargon shouldn't own prime space. The last style
  used is remembered.
- Deletes are reversible: a 6-second undo bar instead of blocking confirms;
  blocking confirms are reserved for genuinely destructive bulk actions.
- **Deadlines**: a Doc can carry a due date (custom-built calendar picker —
  the native date input can't be themed and clashed with the dark UI);
  status escalates calm → warn → danger by color on one status line, shows
  the uncited-clip count, and offers a "Cite them →" jump into History.
- **Completed tab**: finished projects move out of the active list. I
  originally recommended a collapsed section (Hick's Law: a third tab is a
  permanent cost for rarely-used content) but the user chose a dedicated
  tab after hearing the critique — shipped as instructed, with a
  confirmation flash instead of a jarring auto-tab-switch.

### Deep-dive 1 — Works Cited, auto-maintained
- Per-clip citations existed but sat scattered next to clips; assembling a
  bibliography was still manual. Now every Cite click rebuilds a "Works
  Cited" block at the true end of the Doc: **deduplicated by source page**
  (several quotes from one article = one entry, like a real bibliography),
  alphabetized, and re-rendered entirely in whichever citation style was
  just picked (so the list is always style-consistent).
- Rebuild-don't-append was the key decision: it's the only way to keep the
  list ordered, deduplicated, at the actual bottom, and in one style. The
  old block is deleted via a NamedRange bookmark and rebuilt.
- Live-testing found a real bug: re-citing an already-cited clip in a new
  style updated the clipboard but not the Doc (the write-back was gated to
  first-cite only). The fix — running the rebuild on *every* successful
  cite — was strictly better than patching the one entry, because it made
  the whole list style-consistent as a side effect.
- Feedback design: silent on success (the "Copied ✓" flash already
  confirms the primary action; double confirmation is noise) but never
  silent on failure — "Doc update failed" appears in the same flash slot.
- One user report turned out to be correct behavior: citing a second quote
  from the same article "replaced" the first entry — actually dedup by
  source working as designed. The resolution was an explanation (one
  bibliography entry per source, like any real Works Cited page), not a
  code change.

### Deep-dive 2 — Lecture-timestamp clipping
- Students learn from YouTube lectures; a clip's source link pointed at the
  video, not the moment — "re-check that proof" meant scrubbing a
  90-minute lecture.
- Now, clips saved on a YouTube watch page carry the video moment: the
  transcript line's own timestamp when the selection sits inside the
  transcript panel (precise to the sentence, independent of where playback
  is paused), else the player's current time. The Doc bullet gains a small
  caption-styled " · 43:21" link and History's Source button reopens the
  lecture already playing at that moment — the Doc becomes a clickable
  index of the lecture.
- The invisible design work: the timestamp is stored as its own field and
  **never baked into the clip's URL**, because the URL doubles as the
  page's identity in five subsystems (article-grouping, Works Cited dedup,
  archive keying, and more). A naive `&t=43s` would have made every clip
  from one lecture look like a different source: duplicate headings,
  duplicate bibliography entries.
- Failure mode is graceful: if YouTube's transcript markup changes,
  detection silently falls back to playback time, then to a normal untimed
  clip. Tested live and confirmed working.

### Deep-dive 3 — BYO-AI layer
- Philosophy first (decided before any code, from a critique of AI study
  tools): **AI may classify and ask questions; it may never do the
  student's thinking.** The per-clip action returns exactly three
  follow-up questions — never a written reflection or summary of their own
  note — because the learner doing the digestion is where learning
  happens.
- Bring-your-own-key: user connects their own OpenAI, Anthropic, or Google
  Gemini API key. Selecting a provider opens that provider's real key page
  in a new tab; the key is validated against a free models-list endpoint
  (fails fast, costs nothing) before being stored **device-local, not
  synced** (a raw API key shouldn't ride cloud sync). No server ever sees
  it — consistent with the no-server thesis.
- Invisible until connected: AI menu items don't render disabled — they
  don't render at all without a key.
- Two actions: per-clip "Follow-up questions" and per-doc "Summarize",
  both behind existing overflow menus (no new buttons on the primary row).
- Live debugging yielded three findings worth telling: (1) a generic "key
  rejected" error was hiding the real cause — the fix was reading the
  provider's actual error body instead of guessing from the HTTP status;
  (2) the real cause was Anthropic blocking direct browser requests
  without an explicit opt-in header — a documented, sanctioned flag for
  exactly this own-key-in-own-browser architecture; (3) a genuine UX
  finding: users assume a Claude Pro subscription includes API access —
  it doesn't (separate billing), and the surfaced error text became the
  diagnostic.

### Deep-dive 4 — Voice notes
(Use the voice-note facts from the Capture section above; the story is the
two failed architectures, then the psychology-first finishing interaction.)

### Design system facts
- Warm near-black surfaces; one electric-violet accent `#A99CFF`; semantic
  danger (red) and warn (amber) colors kept separate from the accent.
- The star exhibit: the "active pill" fill is the accent at exactly **0.18
  alpha** because accent-colored text on it computes to **4.8:1** contrast
  — while 0.22 alpha drops it to **4.42:1**, failing WCAG AA's 4.5:1. The
  ceiling is a computed number, not taste.
- Text ramp is WCAG-locked: the tertiary gray has a hard floor (`#948FA1`)
  below which it fails 4.5:1 on cards.
- 4px spacing grid (4/8/12/16/20/24 as tokens). A real double-spacing bug
  created the rule "never stack a child margin on a parent flex gap": a
  22px gap plus per-child margins produced 32–34px real gaps.
- Icons: an inconsistent mix of emoji (rendered differently per OS,
  colorful against a monochrome UI) was migrated to a tree-shaken Material
  icon set — ~25 call sites, 17 icons, **~8.7KB** added to the bundle
  (chosen over bundling Google's full icon font).

### Motion saga (tell wrong fixes first, in this order)
- The interaction: toggling a doc card active/inactive reorders the list
  (active cards sort above inactive), animated with FLIP (measure each
  card's position before/after, play the delta as a slide) using the Web
  Animations API — chosen over CSS transitions because setting an inline
  CSS transition *replaces* the card's own hover transition (the highlight
  snapped for the whole slide).
- Easing was verified **numerically**, not by eye: Material's standard
  curve `cubic-bezier(0.4, 0, 0.2, 1)` has a zero tangent at t=0 yet
  reaches ~24% progress by 25% of the duration — near-linear in practice.
  The chosen curve `cubic-bezier(0.65, 0, 0.35, 1)` reaches only ~7% —
  genuinely slow at both ends.
- User: "sudden jerk on toggle click." **Wrong fix #1:** GPU layer
  promotion (`will-change`) to isolate the slide from the hover repaint —
  a real improvement, but not the cause. **Wrong fix #2:** a 140ms hold
  before the slide ("click, pause, move") — made it *worse*. **Root
  cause:** with `fill: 'none'`, a delayed Web Animation applies no
  keyframes during its delay — so the card jumped to its final position,
  sat there, jumped *back* to the start, then slid. `fill: 'backwards'`
  (hold the first keyframe through the delay) was the one-word fix.
- Then the systemic pass: interruption continuity (rapid re-toggling now
  folds the in-flight position into the new slide instead of snapping);
  everything that visibly moves joined the animation ("Add document"
  button teleported while cards glided); **"data arriving is not
  movement"** — the docs list loads async, so on every drawer open the
  first render is empty and the second is populated; anything existing in
  both renders ghost-slid on open until a guard distinguished data-arrival
  from reordering (the same bug then reappeared through a second
  mechanism — a CSS mount animation on the section divider — and needed a
  render-time twin of the guard).
- Hover polish: card action rows expand on hover with a 0.14s hover-intent
  delay (equal to the reorder hold, so all drawer motion shares one
  rhythm) — sweeping the mouse across the list no longer churns every
  grazed card, because a delayed CSS transition cancels outright if the
  pointer leaves first. Any property a hover state changes must be in the
  transition list — border-color and opacity were each once missing,
  snapping at the exact onset of smooth motion.
- A user report of "top padding smaller than bottom padding" on cards was
  actually an invisible collapsed row: with border-box sizing an element's
  height can never shrink below its own padding, so the hidden hover-row's
  16px padding left a phantom band under every card. Padding now exists
  only in the expanded state.
- Final lesson, from the user's "keep it simple and minimal" on an
  over-choreographed form-open animation: **two motion registers** — slow
  symmetric curves belong to *system-initiated* rearrangement; direct user
  commands get a fast ease-out (0.22s) that responds immediately. A
  user-invoked control on the system clock reads as laggy, not gentle.

### Designing by subtraction
- **Topic Auto-Clustering — built, then deleted.** Tag/domain chips above
  search that filtered on click. At realistic archive sizes the chips
  carried no signal (a domain chip covering ~100% of clips filters to
  "everything"), and inline #tag chips already served the browse value.
  One capability was salvaged: search now matches source URLs.
- **Soft Triage / "Someday" — shipped, then fully removed** on direct user
  feedback ("I don't like it"). An optional Someday tag plus an occasional
  zero-consequence "still relevant?" check-in. Lesson: features that add
  standing UI and bookkeeping lose; features that live inside existing
  actions win. Stored data was left untouched — the fields are simply no
  longer read.
- **✨ Resurfaced — paused, not removed** ("keep it for future"): a daily
  spotlight of one old clip. The picker function remains intact; one line
  disables it. A different verdict from deletion, deliberately.

### Live-feedback diagnostic stories (pick three)
1. "Copied ✓" feedback was invisible: choosing a citation style closed the
   dropdown, which physically moved the cursor onto the *next* card —
   hover was lost and the action row collapsed before the feedback could
   render. Fix: the row stays pinned open by state for exactly as long as
   feedback is showing, regardless of cursor position.
2. The phantom card padding (border-box padding floor, above).
3. The "replaced citation" report that was correct dedup behavior — the
   fix was a mental-model bridge (explanation), not code.

### Accessibility & trust facts
- Every contrast ratio in the token sheet computed and recorded; two
  numbers memorable enough to quote (4.8:1 at 0.18 alpha; the #948FA1
  floor).
- Full keyboard operability; focus-visible rings on every interactive
  element.
- A long-lived invalid-HTML bug: the account dropdown was nested inside
  its own trigger `<button>` — browsers silently re-parent nested
  interactive content, so the real DOM didn't match the JSX. Found by
  diffing the parsed DOM against the source; the rule became "a trigger
  button and its menu are siblings under one positioned wrapper, never
  parent/child."
- `prefers-reduced-motion` honored across every animation, including
  mount-gated ones.
- Undo-over-confirm philosophy for destructive actions.

### What's next (present as designed-but-unbuilt, with critique)
- **Closed-Book Revisit**: when the student organically returns to a page
  they clipped weeks ago, a small dismissible pill asks them to recall
  what mattered *before* revealing their old clips — retrieval practice
  (the testing effect, among the most replicated findings in cognitive
  psychology) triggered by existing behavior instead of a scheduled review
  queue. Its own critique, stated honestly: it interrupts browsing (must
  be one-click dismissible, per-site muteable, silent for recent clips);
  the reveal must never auto-grade ("you remembered 1 of 3" would be shame
  mechanics); and it's invisible until revisits happen, so it can't be
  demoed on command.

### Honest results framing
- Solo project; validated through continuous live testing with one primary
  user whose screenshot-driven bug reports shaped multiple iterations.
  Every feature listed shipped and builds clean; lecture timestamps and
  the AI layer were confirmed working end-to-end in live use. No usage
  metrics exist — do not fabricate any.
- "What I'd do differently": establish the motion invariants before the
  animation work instead of excavating them bug by bug; concept-test
  Someday with users before building it.

## OUTPUT

Produce only the finished case study in Markdown. No preamble, no notes to
me, no meta-commentary. Start with the H1 title.
