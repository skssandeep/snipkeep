# SnipKeep

**Turn web reading into a research archive that lives in your own Google Doc — no server, no account, no lock-in.**

Select text on any page, hit save, and the clip lands in a Google Doc you already own: formatted, sourced, and citable. SnipKeep has no backend and no database. Every competitor that stored users' archives in their own infrastructure (Pocket, Omnivore) shut down within the last two years and took those archives with them. SnipKeep is built so that outcome is structurally impossible — if the extension disappeared tomorrow, your notes are still just a Google Doc.

## What it does

- **Clip from anywhere** — a floating toolbar appears on text selection (keyboard-driven: arrow keys + Enter), or use `Cmd/Ctrl+Shift+S`. Right-click saves images.
- **Everything lands in your Doc, formatted** — article headings, source captions, preserved hyperlinks, and bullets, written via the Google Docs API with your own OAuth token.
- **Margin notes, typed or spoken** — attach "your take" to any clip; voice input streams live into the note field.
- **Lecture-timestamp clipping** — clips from a YouTube watch page carry the video moment; the Doc gets a ` · 43:21` link that reopens the video right there.
- **Full-text searchable history** — with per-clip citation copy (APA / MLA / BibTeX) and an auto-maintained, deduplicated **Works Cited** section at the bottom of the Doc.
- **Deadline-aware docs** — give a doc a due date and get a calm → warning → urgent countdown with an uncited-clips count.
- **Link-rot insurance** — a best-effort Wayback Machine snapshot is taken at save time and written back next to the clip's source link.
- **Bring-your-own-AI-key (optional)** — connect your own OpenAI / Anthropic / Gemini key for follow-up questions per clip and per-doc summaries. The key stays on-device; calls go straight from your browser to your provider. No key, no AI — the features are invisible until you opt in.

## Why there's no server (the actual design thesis)

The product's job is to disappear into the user's own work. That one constraint drove every architectural decision:

- **Storage** is `chrome.storage` (device/sync) plus the user's Google Doc. Nothing else.
- **Auth** is Chrome's built-in `chrome.identity` OAuth — the token never leaves the browser.
- **AI** is the user's own API key calling the provider directly (with the documented CORS opt-in header for Anthropic). SnipKeep never proxies or sees a prompt.
- **Trust is a feature**: a Privacy Ledger screen in the drawer gives a literal, honest account of exactly what leaves the device and where it goes.

## Engineering highlights

This repo is heavily documented — not just *what* was built but *why*, including the failures. Some places to look:

- **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — the research-driven feature roadmap, including two features that were **built, evaluated against real use, and deleted** (with the reasoning). Product judgment is subtraction, not accumulation.
- **[`docs/FEATURES.md`](docs/FEATURES.md)** — mechanics of every shipped feature.
- **Voice notes** required three architectural attempts, each documented: content-script mic permissions are scoped per-website (rejected), `chrome.offscreen` documents cannot show a permission prompt at all (built, tested live, root-caused against Chromium, reverted), so recognition runs in a real background tab that foregrounds itself only when the permission state actually requires it. Includes a handled race between silence-based auto-stop and Enter-to-save.
- **Motion design is verified numerically, not eyeballed** — the list-reorder FLIP animation (Web Animations API, not CSS transitions — the comments explain the two bugs that distinction fixed) uses an easing curve chosen by solving the bezier progress function, and the design tokens are WCAG-checked by computation (the accent-tint ceiling is documented as "0.18 → 4.8:1 passes; 0.22 → 4.42:1 fails").
- **MV3 correctness details** — frame-targeted messaging (`all_frames` + explicit `frameId` vs. focus-guarded broadcast, per message), service-worker-restart-safe state, and Shadow DOM isolation for every injected surface.

## Stack

React 18 · TypeScript (strict) · Vite + `vite-plugin-web-extension` · Manifest V3 · Radix UI (drawer) · Google Docs API · Web Speech API

## Run it locally

```bash
npm install
npm run build        # production build → dist/
npm run dev          # watch mode
npm run typecheck    # tsc --noEmit
```

Then load it: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.

> Google OAuth note: the Docs scopes are tied to the extension ID baked into `manifest.json`'s `key` field. For your own build, create a Google Cloud OAuth client for a Chrome extension and replace `oauth2.client_id`.

## Status

Actively developed personal project. The core loop (clip → organize → cite) is complete; the remaining roadmap items (weekly synthesis digest, anonymous highlight signal) are deliberately deferred — the second one is the only feature that would ever need a backend, and it doesn't ship until it can pass a real privacy review.
