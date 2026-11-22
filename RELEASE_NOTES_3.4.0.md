# KeyFlow Next 3.4.0 — Durable AI drafts and Focus Key Ribbon

## Confirmed defect and root cause

In 3.3.0, AI Studio's **Practice now** action routed an in-memory `generatedDraft` object straight to Practice. The draft had not necessarily been written to the Library's IndexedDB `texts` store. Consequently, viewing it and closing the application could lose it entirely. On restart, the no-repeat selector would not find the unsaved draft and could display **No new text**, making it look as though it had been marked completed. This was primarily a persistence bug, not evidence that the user finished typing.

## Fixes

1. **Save first, practice second.** When AI output passes validation, it is written to the same IndexedDB `texts` store as imported passages. The transaction must complete successfully before **Practice now** becomes enabled. A failed save is shown clearly, with **Retry saving**, **Edit and validate**, and **Copy passage** actions.
2. **Unfinished AI passage inbox.** After a successful database write, a small credential-free `keyflow.ai.pending.v1` snapshot identifies the last generated passage. On cold startup, Practice prioritizes the pending passage in the matching language *before* fresh-text exhaustion checks. AI Studio has a resume button; the Library labels it **Saved · unfinished**. Manual re-practice from the Library re-establishes the recovery reminder.
3. **Completion-only lifecycle.** Merely generating, previewing, opening, or typing only part of the AI passage never consumes it. The recovery pointer is cleared only after a matching, fully completed passage session is committed to the sessions database. Non-passage sprint endings and unrelated sessions do not clear it.
4. **Coherent deletion.** Deleting an AI passage from Library clears its matching pending pointer. Dismissing a reminder **does not** delete the saved passage.
5. **Immediate Focus Key Ribbon.** Expected character, suggested physical key/chord, finger guidance and recent wrong-versus-correct input are displayed in a fixed-height strip directly above the passage. No typing glyphs are reflowed or reconstructed for the hint; the existing caret renderer is unchanged. Narrow layouts compact the header, diagnostics and routines so the passage remains visible.
6. **More useful AI Studio.** The generator can draw weak keys/transitions from local measured sessions, distinguishes five levels in its instructions, aligns generation defaults with active practice settings, and can edit/revalidate the generated passage before using it. Existing Dahl/OpenRouter integration, bounded retries, cancel, model health and secret-redacted traces remain intact.
7. **No fake storage success.** IndexedDB-unavailable `saveText` now rejects instead of resolving while dropping the passage.

## Files changed

- `app/main.js` — save/route lifecycle, resume actions, focus ribbon and AI tools.
- `app/core/ai-drafts.js` — new safe, recoverable AI draft state helpers.
- `app/core/storage.js` — committed text saves and ID lookup.
- `app/ai/generator.js` — stronger difficulty and output coherence instructions.
- `app/studio.css` — fixed-height next-key strip and compact typing-first layout.
- `tests/regression-3.4.mjs` — 13 new source/logic regression checks.
- `tests/run-v34-ai-browser.py` — real Chromium application flow using a deterministic mock provider and IndexedDB fixture.
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` — version 3.4.0 and tests.

## Verified

- `npm run check` passed: full JS suite, 13 v3.4 checks, module/Rust/Tauri/build source contracts and AppImage audit scripts.
- `python tests/run-v34-ai-browser.py` passed: Generate → committed save → Practice now without typing → navigate → application remount → same unfinished passage restored, with no unhandled JS errors.
- `python tests/run-studio-browser.py` passed: real application route/UI operation at narrow widths, wrong-key feedback and RTL responsiveness.
- `python tests/run-v31-browser.py` passed: Persian caret alignment over 450–1260px and duplicate resize events.

**Not verified:** native compiled AppImage or production WebKitGTK behavior, real paid/free provider responses with a user's credentials, Linux wallet integration, production network latency, and actual on-device storage permissions. The browser AI provider is explicitly mocked; it verifies the application save lifecycle, not a live provider's quality.

## Privacy and scope

- The local pending snapshot contains passage text and safe metadata, **not** API keys, HTTP headers, user typing sessions, or diagnostics. It is written only after the full record is committed to IndexedDB.
- If browser localStorage denies writes but IndexedDB is writable, the passage is saved and the user receives a warning that the startup reminder is unavailable. The Library remains the source of truth.
- This release does not introduce a UI framework, GPU shader, continuous polling animation or third-party network service.
