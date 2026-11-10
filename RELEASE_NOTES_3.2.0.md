# KeyFlow Next 3.2.0 — Reliability, Adaptive AI & Personalization

## Why this release exists

The most important user-reported defect was that opening or starting a text could
make it count as "used", even if never completed. The anti-repeat scheduler
confused **exposure**, **typing start** and **verified completion**. Older
versions left false history records that also survived app restarts.

This release changes the data model, not just the text of the empty-library banner.

## 1. Completion-only passage history

- Previewing a text writes no freshness record.
- Typing any number of characters and then leaving a session does **not**
  quarantine that text. The interrupted-session checkpoint remains separate.
- After a successfully saved passage completion, the app records its original
  source ID, original-content fingerprint, finish timestamp and session ID.
- For a mixed deck in a timed sprint, **only source components that were fully
  reached** are marked completed. Trailing unseen or unfinished source parts
  remain selectable.
- Writes are idempotent per saved session, avoiding inflated counts during
  retries or crash recovery.
- Schema-4 freshness history ignores obsolete first-key "committed" records.
  The background migration reconstructs completions from real saved sessions,
  without fabricating completions from a partial sprint or unfinished run.
- The migration is also triggered when a genuine session finishes before the
  deferred startup migration has run. Existing IndexedDB session history and
  personal texts are not deleted.
- The AI Library passage-history calculations no longer count first-key
  exposure entries as completed.

## 2. Startup and input latency

- First practice uses bundled text without waiting for IndexedDB to upgrade.
- Native runtime inspection is asynchronous after the first screen is mounted.
- Sound framework initialization is delayed until after initial rendering.
  The first few keystrokes may be silent until audio is ready.
- Library/history preload, ghost lookups and heatmap computation are deferred;
  background heatmap loading backs off while typing is active.
- Per-key first-press localStorage history write was removed entirely.
- The live passage-segment HUD updates textContent only when its label changes.
- Retained v3.1 `ResizeObserver` coalescing, stable feedback slots and Persian
  UTF-16/grapheme-aware caret positioning.

These changes reduce avoidable work, but the Linux desktop's GPU, WebKitGTK,
AppImage multimedia stack and user hardware can still affect native latency.

## 3. AI generation: bounded, inspectable and resilient

- AI Studio now has **Speed** (up to 2 generation calls), **Balanced** (up to 4)
  and **Quality** (up to 6) profiles. Optional Quality copyediting is an
  additional call and is never required to accept an otherwise valid draft.
- OpenRouter reasoning-only `finish=length` exhaustion receives one targeted
  recovery with lower reasoning effort and increased completion budget.
- Provider/model failures are surfaced as an inspectable diagnostic trace,
  including model, kind and request count, **without storing prompts or keys**.
- HTTP 401/402/403 stop immediately: retrying different models with the same
  invalid or exhausted account would waste time. Error details are redacted.
- API compatibility retries are limited to explicit rejected request fields
  (e.g., token-budget parameter name or sampling controls).
- Cancellation prevents further processing, including Quality review; on the
  native Tauri bridge, an already dispatched IPC request may still finish
  remotely because the existing bridge is not natively cancellable.
- OpenRouter discovery is free-model-only by default. Paid models require an
  explicit opt-in and may incur provider charges.
- Local per-model health records (success/failure counts and transient cooldown)
  bias **automatic fallback** away from repeatedly broken or empty-output
  models. Manual model selection is never blocked; counters can be reset.
- Dahl, OpenRouter, custom OpenAI-compatible, Groq, Gemini, Mistral, Cerebras,
  NVIDIA and Cloudflare integrations remain present.
- Prompt maker and offline paste/import are preserved as a key-free fallback.

Live model lists only confirm discovery, not a successful usable completion.

## 4. Customizable workspace

Settings → Personal workspace provides:

1. Color palette: Amber, Ocean, Mint, Violet or Rose.
2. Comfortable or Compact density.
3. Underline, Block or Outline caret style.
4. Practice reading width: 850, 1050, 1250 or 1450 pixels.
5. Show or hide the visual keyboard without hiding next-key guidance.

Appearance is persisted locally and applied as CSS variables/body attributes,
not by rebuilding the passage on every keystroke. Also fixed the schema migration
that incorrectly reset the user-selected `quick` length mode.

## Verification

Passed in this environment:

- `npm run check`: all existing JS tests, 12 new v3.2 tests, module resolution,
  Rust source audits, Tauri version contract and AppImage packaging contract.
- `python tests/run-v31-browser.py`: real typing-engine responsive caret and
  wrong-key geometry at 450–1260 px, 180 duplicate resize events.
- `python tests/run-v32-appearance-browser.py`: styles/presets within 490 px.
- ZIP archive integrity verification.

**Not verified in this environment:** compiled native Linux AppImage, live
account-authenticated requests with user's own provider credentials, and a full
application-shell Chromium browser test. The environment disallows browser
navigation, so full-shell tests that require a localhost URL cannot run here.

## Files and upgrade

Source is under `app/` and `src-tauri/`. Version is 3.2.0 in `package.json`,
`src-tauri/tauri.conf.json` and Cargo.toml. See `UPGRADE_GUIDE_3.2.0.md`.
