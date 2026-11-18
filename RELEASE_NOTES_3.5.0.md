# KeyFlow Next 3.5.0 — Adaptive Time Trials + AI Quota Guard

## Problem reproduced from the supplied diagnostic trace

- The Qwen response was 1713 characters against a maximum of 1050. The former planner rejected it wholesale, then spent a second complete generation request trying to repair a length-only failure.
- The next Groq call encountered an organization-level output token per minute (OTPM) rate limit: 1000 allowed, 554 used. A successful model catalog request cannot override account limits.
- GPT-OSS spent nearly its entire 16000-token completion budget on reasoning (15998 reasoning tokens), returned no text, and subsequently hit an 8000 TPM limit. More output tokens were not a useful recovery.
- The Groq adapter used OpenRouter-style `reasoning: {effort}`, but Groq documents a top-level `reasoning_effort` setting. The two providers must not share a one-size-fits-all request body.

## Changes

1. **Groq-specific thinking controls**: Qwen 3.8 27B receives `reasoning_effort: "none"`; GPT-OSS 20B/120B receive `reasoning_effort: "low"`. Other Groq models receive no speculative thinking parameter. The parameter is removed if the server explicitly rejects it.
2. **Output quota guard**: Groq text generation uses at most 900 output tokens per request; provider tests use 256. Length-limited empty Groq responses switch models instead of doubling their request size.
3. **Local length fit**: A generated passage exceeding the maximum is checked for a safe, complete-sentence excerpt inside the required length range. The result still passes language, keyboard, repetition, duplicate and other content rules. If a safe excerpt cannot be found, ordinary bounded repair applies.
4. **Rate-limit-aware routing**: 429 errors are distinct from generic HTTP failures, retain retry-after seconds, and cool the model down at once. Automatic fallbacks skip cooling models. The studio explains model availability versus verified output and advises when a Groq account is unsuitable for long prose.
5. **Saved key race protection**: Generation/model tests can unlock an already saved credential on demand when the asynchronous wallet UI has not finished populating.
6. **Adaptive time trial**: New Intermediate (45 English / 36 Persian reference WPM) and Professional (80 / 65) choices. The allowance increases with text length, difficulty, and keyboard-heavy characters. No target is based on generated title or stale text metadata.
7. **Unfinished text analysis**: Timeouts finalize a saved partial run even if just one letter was entered. Review shows typed coverage, accuracy, speed, mistakes, corrections, remaining characters, and a coverage × accuracy grade. The Library's per-passage attempt history carries pass/miss result and score.
8. **Honest completion bookkeeping**: A time-trial deadline does not count as passage completion, consume a fresh text, clear a recoverable AI draft, or award passage-based progression. If the user completes the full passage before the deadline, normal completion rules apply and a pass is shown.
9. **Responsive visual feedback**: A compact, fixed-height countdown board stays above the focused key rail and typing text. The clock and progress indicator update without rebuilding the glyph layer or moving the cursor.

## Technical details and limits

- Trial clocks begin on the first keystroke, run on monotonic elapsed time, and do not auto-pause for inactivity or lost focus. Navigation before time expires still uses existing recovery/checkpoint behavior.
- Only actual saved sessions appear in history; opening or previewing a draft does not create a completion.
- Provider quotas vary by organization and may prevent a request even under 900 tokens. The program cannot raise an external account limit or promise that every model will generate English/Persian prose reliably.
- Groq low-output quotas may not support Long/Endurance passages, especially in Persian. The AI Studio warns about this; use a suitable provider or the external prompt maker.
- Full native AppImage/WebKitGTK integration and real provider-account calls must be exercised on the target computer. Regression tests use local stubs, no credentials or external charges.

## Source references

- [Groq Rate Limits](https://console.groq.com/docs/rate-limits): TPM, optional OTPM, organization-level restrictions and retry-after headers.
- [Groq Reasoning](https://console.groq.com/docs/reasoning): Qwen 3.8 supports reasoning `none`; GPT-OSS supports `low`, `medium`, and `high` using `reasoning_effort`.
- [Groq API Reference](https://console.groq.com/docs/api-reference): OpenAI-compatible chat completion API.

## Checks

- `npm run check` runs all prior regressions, new `tests/regression-3.5.mjs` and app contracts.
- The 3.5 tests cover 1713-character length recovery, 429 + reasoning-only fallback, Groq payload shape, instant cooldown, key-by-key timeouts, boundary times, level/language variation, scoring and UI wiring.
