# Keyflow 2.4.0

This release focuses on correctness, longer training, progression, AI routing, and startup responsiveness.

## Reliability

- Replaced the vulnerable completion-speed path with a monotonic active-session clock and a conventional net-WPM formula: gross WPM minus uncorrected errors per minute.
- Sessions with impossible timing or >350 gross WPM are marked anomalous and are excluded from PBs, trends, progression pace, and reliable averages.
- Live WPM remains in warm-up until at least 12 typed keys and 2.5 seconds of active typing have elapsed. Burst pace is tracked separately.
- Window blur cannot pause/freeze a session before the first key has actually started it.

## Longer, less repetitive practice

- Standard/Long/Endurance length targets now scale from 420 characters at Level 1 standard to more than 2,100 characters at Level 5 endurance.
- Smart Deck selects exact-level sources before adjacent/fallback levels, so Level 1–5 is a real content progression rather than a label.
- Composite passages can use up to 12 source passages, allowing sustained sessions even though individual built-ins remain readable modules.
- Recent source IDs and normalized content fingerprints are tracked globally per language. The protected recent tail is sized so it prevents immediate repeats without permanently marking the entire small corpus as recent.

## Progression and analytics

- Ten permanent XP ranks: Foundation through Master. Rank never falls because of a weak day.
- Adaptive training difficulty remains separate from permanent rank.
- Three-session curriculum engine selects accuracy repair, rhythm, controlled pace, endurance, or symbols based on real recent data.
- Added burst WPM, flow score, median key interval, hand balance, correction rate, errors/1k, long pauses, trend, timing reliability, anomaly count, reliable PB, and input queue p95.

## AI

- Native proxy transport supports `http://`, `https://`, `socks5://`, and `socks5h://`; the default preset is `socks5h://127.0.0.1:10808`.
- Live provider discovery remains the source of model IDs; no retired model is hard-coded.
- Transient errors use retry/backoff and optional live-model fallback.
- AI passages support Long and Endurance generation, validation/repair, optional deep editing, and n-gram duplicate rejection against existing text.

## Sound and performance

- Cuelume 0.2.4 remains the only interaction sound engine.
- The default profile is now Soft at 34% global volume with heavily attenuated per-key cues; Mechanical, Minimal, and Playful remain selectable.
- Extremely fast duplicate type cues are cadence-limited, while Space, errors, deletion, and completion still get distinct feedback.
- Historical heatmap queries are deferred with `requestIdleCallback` (or a delayed fallback) so opening Practice does not compete with the first keystroke.
- Session/stat queries use bounded IndexedDB cursors instead of loading the entire history.

## Validation

`npm run check` covers functional metrics, the million-WPM regression, smart-deck repeat behavior, level/length progression, XP monotonicity, Persian DOM shaping, Cuelume mapping, ES module contracts, native proxy/Rust regressions, the exact Tauri stack, and AppImage runtime audits.
