# KeyFlow Next 3.1.0 — Responsive Precision

This release improves the existing typing workflow, with emphasis on small and changing window sizes, correct caret and key feedback, and predictable difficulty/length. It retains the v3.0 Precision Lab, personal progress, Dahl/OpenRouter integration, and source-passage freshness tracking.

## Changes delivered

1. **Resize-event coalescing:** the typing engine coalesces ResizeObserver notifications in `requestAnimationFrame`, compares a geometry signature before repainting, and cancels pending work when destroyed. Geometry watches account for viewport position and glyph size as well as the passage container; this avoids the previous resize/overlay feedback cycle.
2. **Steadier RTL caret positioning:** caret and wrong/correct markers are recalculated only for meaningful geometry changes. Persian grapheme-based typing retains text shaping inside a single underlying text node.
3. **Persistent above-text key guide:** next expected character, physical key/chord hints, finger hint, and recently pressed key appear before the text, rather than hidden at the bottom of a long passage. The guide updates with typing.
4. **Visible mistake detail:** a reserved-height above-passage panel shows the exact key that was pressed next to the expected character; it accumulates recent errors and distinguishes spaces and special keys. Because it reserves space in advance, triggering an error does not move the passage.
5. **Actual correctness indicators:** the wrong key is shown next to the caret, and a small trail of correctly typed Persian glyphs is highlighted without splitting text shaping or pushing the caret. Correctness feedback has no ordinary text-layout cost.
6. **Five real difficulty tiers:** Beginner, Easy, Medium, Hard, Expert. A manual choice restricts texts to that tier; Auto follows the earned skill stage. Selecting a higher difficulty does not artificially change the earned skill tier.
7. **Four balanced length modes:** Quick, Standard, Long, Endurance. The scheduler targets 88%–110% of the intended character length when enough eligible, fresh passages exist. It favors natural sentence endings, distinct topics, least-used sources, and preserves source identities when excerpts are used. It no longer silently crosses difficulty tiers just to fill a deck.
8. **Substantially expanded content:** 70 original Persian/English passages (35 per language) across all five tiers, including number and punctuation exercises. Total built-in content is 154 passages, 77 per language. Source texts remain available for per-passage history and no-repeat checks.
9. **Improved Persian usage/history attribution:** source offsets are converted from UTF-16 positions into grapheme positions, including combined characters, so a mixed passage only credits sources the user actually reached.

## Validation

- Entire `npm run check` source suite (including new v3.1 scheduler tests and existing JavaScript, app contracts, Rust source and AppImage audit scripts).
- Real Chromium, actual typing engine: resize/caret stress tests at 450–1260px, 180 redundant resize events, above-passage mistake area, and wrong-key feedback.
- Existing Chromium highlighting tests for Persian text/caret/backspace (where supported by the current test environment).

**Limits:** This release is a tested source archive, not a precompiled AppImage. No native Linux WebKitGTK/KWallet build or live authenticated AI calls have been verified here. Full app shell navigation in Chromium may be restricted by this test environment; engine/component tests do not establish complete end-to-end coverage. With an exhausted exact-level pool, a shorter passage or an explicit empty state can still occur rather than silently substituting a different difficulty.

## Developer commands

```sh
npm run check
npm run test:responsive:browser
npm run test:highlight:browser
```

The browser scripts require Python Playwright and Chromium. See `UPGRADE_GUIDE_3.1.0.md` for safe migration.
