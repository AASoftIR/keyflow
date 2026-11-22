# KeyFlow Next 3.6.0 — release notes

## AI Studio

- **Faster navigation:** the screen draws immediately. A delayed, cancellable-by-route analytics query pre-fills weak keys only if the field is still empty. The full Library and near-duplicate comparison are loaded when generation actually begins, preserving duplicate protection.
- **Six mission-specific prompts:** Natural reading flow, weak-key/transition repair, punctuation, contextual numbers, steady rhythm, and real-world situations. Each affects the generated prose in English and Persian; the selected mission is saved as a text tag.
- **Correct weak-pair handling:** text from the weakness button is tokenized on whitespace (`th`, `ou`, etc. remain pairs) instead of being split into individual Unicode characters.
- **Low-quota setup:** sets short length, Speed profile (max two generation calls), and minimal reasoning preference. It is an option, not a claim that your provider has quota or a guarantee of successful output.
- **Request plan summary:** shows the configured length, actual Groq per-request cap or selected other-provider cap, and maximum generation calls. Optional Quality copyediting can add one separate call and uses a 900-token output cap on Groq.
- **Failure explanations:** bounded-call diagnostics can now distinguish provider token-per-minute limits, reasoning-only/empty completions, and output-length mismatch. Credentials remain excluded from trace output.
- **Preview tools:** character/word count, estimated typing minutes, difficulty, mission, and an explicit API-consuming Generate another variation action. Existing auto-save, editing, external prompt maker, model-health fallback, and pending AI text recovery remain intact.

## Practice and spoken coaching

- **Accuracy targets:** Off, 95%, 97%, 99%. Live feedback reports measured total-keystroke accuracy (wrong presses still count) and indicates whether the goal is being met; the completion modal records a pass/miss badge, including when scoring a partial timed trial. This goal does not secretly enable Strict Accuracy or alter ranking rules.
- **Local voice coach:** Off / mistakes / milestone+finish / both. Error announcements are throttled to avoid constant speech, and 25%/50%/75% completion milestones are optional. Voice selection, rate (0.7–1.35×), volume, and a manual test are in Settings; a cycling quick toggle is in Practice.
- **Speech privacy and graceful fallback:** voices must explicitly report `localService === true`. No speech API server, captured keystroke history, or remote TTS endpoint is introduced. In WebKitGTK installations without locally advertised speech voices, spoken coaching will remain unavailable; Cuelume audio feedback is unaffected.
- **Cursor and focus stability:** the accuracy indicator occupies a fixed-height box before the target passage; per-key updates cannot resize it. The old next-key ribbon, visible wrong/expected input, hardware chord/finger guides, and Arabic shaping safeguards remain untouched.

## Performance

- Removed the redundant `_queueLayoutCheck()` from the engine's 500 ms statistics tick. ResizeObserver, scroll/zoom and follow-cursor events still invalidate position when needed.
- Cached physical keyboard keycap nodes by `KeyboardEvent.code`, avoiding two selector traversals per change and skipping unchanged highlights.
- Throttled expensive secondary metrics to at most 10 updates/second during a burst. Typed text, caret location, mistake panel, next-key chord and passage progress update immediately.
- Deferred initial AI personalization so the AI Studio screen no longer waits on session and Library database reads.

## Verification

`npm run check` passed on the source tree, including all historical regressions, eight v3.6 regressions, module import/export checks, Rust/Tauri version contracts and AppImage runtime packaging audits. Syntax checks passed. Voice tests used an isolated mocked speech engine and verified that non-local voices are excluded.

**Not verified here:** full Tauri/AppImage compilation, graphical launch on an EndeavourOS/KDE host, real Groq/OpenRouter/Dahl authentication and paid/provider quota behavior, and end-to-end speech output through the user's installed voice backend. These require user-specific hardware, credentials or native runtime access. The release contains complete source, not a precompiled AppImage.
