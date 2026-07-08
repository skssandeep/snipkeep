# SnipKeep — Idea Backlog (creative, unranked-by-obligation)

Generated 2026-07-08 on request: "detailed research, top 5 creative ideas, no
competitor comparison — pure creativity about what else this specific project
could become." Distinct from `docs/ROADMAP.md` (the original research-report
roadmap, now fully shipped/deferred) — this is a fresh pass, not a continuation
of that list. Each idea below was checked against this project's existing
ground rules before being kept: never let investment become lock-in, no
punitive/shame mechanics, no new backend unless the user explicitly brings
their own credentials, invisible/zero-friction by default.

## 1. Voice-note capture at the moment of clipping — BUILDING NOW

The single highest-leverage intervention against the collector's fallacy this
project is built around: a clip *with* a note is far more likely to get
revisited than a bare highlight, and typing a note is the exact friction that
makes people skip it. Hold a mic button while clipping and speak a short "why
I'm saving this" instead of typing — transcribed live via the browser's
built-in Web Speech API, dropped into the existing note field. No server, no
API key, no cost: a native browser capability, not new infrastructure.

## 2. Auto-generated bibliography, living at the bottom of the Doc

Per-clip citations (APA/MLA/BibTeX) already exist, but each just sits next to
its own clip. A **Works Cited section, auto-maintained at the end of the
Doc** — deduplicated, alphabetized, self-updating as citations get added —
turns the Doc from "a log with citations sprinkled in" into something that
actually reads like a finished piece of research. Pure extension of a system
already built; no new subsystem. Probably the fastest, most satisfying next
build after voice notes.

## 3. Bring-your-own-AI-key enrichment layer

The one idea here that's a genuine capability expansion, done in a way that
keeps "no SnipKeep server, ever" completely intact: an optional, locally-
stored AI API key (same trust model as the existing Google OAuth token —
SnipKeep never sees or relays it) unlocking things like "summarize everything
I've saved about this topic" or "suggest three follow-up questions about this
clip." The request goes straight from the user's browser to their own AI
provider. Fully opt-in — invisible to anyone who never adds a key.

## 4. Save-time "Connections" surfacing

Topic Auto-Clustering (report feature #10) was tried and removed — it was
ambient and didn't discriminate at real archive sizes (a domain chip covering
~100% of clips is noise). This is a different mechanism, not a revival: at the
exact moment a *new* clip is saved, a quiet, on-device check ("this shares a
tag/domain with 3 things you saved in March") surfaces only when specific to
that one clip — contextual and tied to a real action, not a standing browse
surface. Sidesteps the exact failure mode that got the earlier attempt killed.

## 5. Doc Milestones — quiet, retrospective, zero-pressure

Deliberately shaped to match the existing "no streaks, no shame" stance: small,
tasteful, purely retrospective celebrations when a Doc crosses a real
threshold ("50 clips in," "three months of steady saving") — never a
countdown, never guilt for missing one. Reinforces the Trust Card's whole
point: this Doc is a real, accumulating body of work, not a database row.
Lowest engineering lift of the five.

---

**Not pursued from the same brainstorm** (recorded so they aren't re-derived
from scratch later): a standalone quick-capture "inbox" for thoughts not tied
to a page selection (risks diluting the clip-first identity); a mobile/cross-
device bridge (needs a backend or companion app — contradicts the no-server
thesis, out of scope entirely).
