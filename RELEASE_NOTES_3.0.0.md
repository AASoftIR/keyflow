# Keyflow Next 3.0.0 — Precision Lab

This release builds on 2.8.2 without removing Dahl, OpenRouter fallbacks, visible incorrect-character feedback, the anti-repeat deck, original Lab workouts, the RTL text renderer, or AppImage GitHub Actions packaging.

## Eight new, **implemented** features

| # | Feature | Entry point | Real behavior |
|---|---|---|---|
| 1 | **Memory-aware spaced reviews** | Lab → Start due review; Library due badges | A reliable, fully completed passage earns a next-review date. Strong accuracy and stable rhythm increase the spacing (1, 3, 7, 14, 30, 60 days); shaky results bring the passage back sooner. A preview or partial sprint cannot count as mastery. Reviews are deliberate replays and do **not** weaken the standard fresh-only picker. |
| 2 | **Personal-best ghost** | Practice → PB ghost toggle; Lab → Open a saved PB passage | Loads a real previous reliable full completion **on identical passage content and language**, reconstructs its keystroke trajectory, and shows a live ahead/behind delta. With no such recording, the original target-WPM line remains. No fictional competitor or fabricated pace samples. |
| 3 | **Error DNA** | Lab → Analyze errors; command palette → `dna` | Counts real wrong-key → expected-key confusions, identifies repeatedly slow keys, finds the exact words where errors occurred, and launches targeted repair. Persian grapheme boundaries are supported. |
| 4 | **Three-stage guided training circuit** | Lab → Begin/Resume circuit; command palette | Complete a baseline, practice a drill derived from its mistakes, then retype the **same original passage**. Stores the circuit and reports actual baseline-to-retest WPM/accuracy. Only reliable full passages advance stages. |
| 5 | **Code Fluency Studio** | Lab → Code fluency picker | Five curated, authentic mini-programs for Python, JavaScript, SQL, Bash and JSON. Type real indentation, punctuation, quotes, case and line breaks, with monospace styling. No AI account required. |
| 6 | **Interruption recovery** | Practice banner / Lab → Resume saved session | Checkpoints are saved **after** input idles and on page hide/navigation; resume keeps cursor, error history, text, and active clock. Time away does not raise the typing duration. Supports English/Persian and avoids re-rendering thousands of marked glyphs. One checkpoint is kept for seven days. |
| 7 | **Private Data Vault** | Lab → Open backup vault; command palette → `backup` | A local JSON backup of settings (allowlisted), full session history, personal passages, bookmarks, rank progression, review dates and circuit. Import validates schema and merges new IndexedDB records by ID; existing records win. Restoring preferences is separately confirmed. API keys in Secret Service, provider config and proxy URL are excluded. |
| 8 | **Live fatigue radar** | Practice header; Lab → Start monitored practice | Observes relative changes in recent typing accuracy and key intervals; signals whether the recent block is steady or deteriorating. It does not automatically interrupt a session, invent scores or run heavy historical analytics on keydown. |

## Integrity, privacy and performance

- Practice-level historical lookups (personal-best ghost, heatmap) happen **after the initial interactive paint**.
- During active typing, the fatigue radar updates constant-space in-memory state. Checkpoints defer localStorage writes until input is idle.
- Date schedules live under `keyflow.review`. Circuit and checkpoint state use `keyflow.circuit` and `keyflow.checkpoint`, respectively; earlier data remains intact.
- Backup import is **merge-not-replace** for IndexedDB and does not modify wallet credentials. Inspect the backup before sharing it: practice passages and keystroke event histories are personal data.
- A completed circuit and PB comparison reflect this user's own past runs; they are not scientifically validated skill estimates.

## Tests run in source environment

- Original JavaScript/regression/contract suite (including the previous AI, English/Persian and freshness scenarios).
- New `tests/regression-3.0.mjs`: 10 regressions covering the review scheduler, full-passage evidence, real PB ghost, Error DNA, fatigue detection, curated code, circuit transitions, credential-free backup, safe checkpoint validation, and UI wiring.
- `tests/run-v3-checkpoint-browser.py`: real Chromium TypingEngine, restart simulation with a reset performance clock, resume and finish with a valid score.
- Existing Chromium Persian highlight/scrolling regression.

**Not tested here:** live Dahl/OpenRouter authenticated service credentials, actual Secret Service/KWallet behavior or a compiled Linux Tauri AppImage. A complete running browser UI smoke was attempted but this execution environment blocks local HTTP/file navigation, so it is not claimed as passing. Vite/Cargo are not installed in the working environment. The ZIP is complete **source**, suitable for the existing GitHub Actions build.

## Research touchpoints / why these designs were chosen

- Monkeytype — practice modes, accurate in-place feedback, results tracking: https://github.com/monkeytypegame/monkeytype
- TypingClub — hands posture, saved progress, replay and accessible lessons: https://www.typingclub.com/
- Typing.com — progress page and attention to problem keys: https://support.typing.com/en/articles/13786241
- ClickClack — n-gram analysis, ghost practice and on-device history: https://apps.apple.com/us/app/clickclack-typing-trainer/id6740695697
- Carpenter et al. — spacing/retrieval practice research, adapted here as passage review (not a claim that this particular algorithm has clinical or educational validation): https://www.nature.com/articles/s44159-022-00089-1
