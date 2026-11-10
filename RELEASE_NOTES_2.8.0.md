# Keyflow Next 2.8.0 — source release

## Included fixes

- **Typing latency:** hot-key handling avoids heavyweight synchronous work, cues are queued, delayed input is diagnosed separately from typing speed, and high-cost effects can be reduced with Ultra performance mode.
- **Text choice:** user-adjustable length, composite/mixed text accounting, freshness and anti-repeat logic, and recovery from legacy preview-only "recently used" records. A mixed passage is committed to usage history only after its constituent text is actually reached while typing.
- **History & Library:** passage-level attempts, finishes, accuracy, WPM, recent sessions, and dates; incomplete typed sessions can count as started, but previewing alone cannot.
- **Progression:** evidence-based skill stages: multiple reliable completed passages with accuracy and pacing thresholds are required for promotion; XP by itself is insufficient.
- **AI studio:** robust extraction across OpenAI-like, Gemini, Workers AI, Responses, text parts and selected stream envelopes; misleading model-catalog entries are filtered; bounded parameter compatibility retries, generation fallback and diagnostics. A model listed by a provider is *not* a guarantee of available text generation.
- **Keys:** on Linux, `secret-tool` saves credentials in Secret Service/KWallet and reports wallet setup failures. Browser-only usage retains keys only for the open session.
- **External AI:** copyable prompt builder with an answer-import workflow, usable without a provider key.
- **Lab:** practical typing drills informed by prior performance, with retained diagnostic summaries and Library drilldown.

## Validation done in this environment

- Existing JS regression suite, new `tests/regression-2.8.mjs` (8 cases), module-import and Rust source contracts, Tauri/version/build contracts, and AppImage runtime-audit tests passed.
- Browser-based RTL caret scrolling and sprint tests were exercised during development.

## Still to verify on your system

- **Not built here:** real Tauri/Rust AppImage, because the working environment does not have the native Rust toolchain/runtime dependencies.
- **Not tested against your accounts:** live model generation and failure modes require individual provider access, valid tokens, network/proxy configuration, and quotas. The implementation is more defensive but no provider can be guaranteed to generate text.
- **Not tested against your personal wallet:** verify `secret-tool` and KWallet integration after installation on EndeavourOS.

## Build on EndeavourOS

`npm install && npm run check && npm run tauri:build`

Or push the source to your own GitHub repository and run the included **EndeavourOS AppImage** workflow. This source archive deliberately excludes `.git`, caches, dependencies and build outputs.
