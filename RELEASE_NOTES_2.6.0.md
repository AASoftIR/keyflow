# Keyflow Next v2.6.0

## Correctness fixes

1. Fixed long text clipping: practice passage now has real vertical overflow.
2. Replaced per-36-character scrolling with per-frame cursor visibility checks based on actual rendered geometry.
3. Cursor-follow calculations clamp to the available scroll extent and work for Persian RTL as well as English.
4. Browser resize/text zoom repositions the active character without rebuilding glyph nodes.
5. Prevented initial DB-opening latency from blocking the first practice screen.
6. Native renderer diagnostics load after the first screen rather than gating the UI.
7. Heatmap aggregation is postponed while actively typing rather than forced by a timeout.
8. Fixed focus handling for toolbar buttons while the document typing listener is active.
9. Idle-time pause prevents lengthy away-from-keyboard gaps from skewing WPM.
10. Fixed stale completion overlays that could reopen after navigation, and ensured timers/observers are disposed.

## Six new training interactions

- Toggle auto-follow.
- Jump back to current typed character.
- Browse previous/next pages of a long passage independently of typed progress.
- Adjust readable text size with A+/A−, persisted across sessions.
- Configurable idle break after 30/45/60/90 seconds, or disable it.
- Segment progress (part and percent) for long practice passages.

## Tests

- `npm run check` passes 17 baseline tests, 23 legacy audit tests, 6 viewport unit checks, 12 new integration assertions and build contracts.
- `python tests/run-viewport-browser.py` passed: Persian passage 1,280 characters, caret remained visible at positions 35, 160, and 420; scrollTop 0→51→370 px.
- Native WebKitGTK AppImage was NOT built or executed in this container. Production `vite build` was NOT run because registry dependency downloads were unavailable. Validate GitHub Actions and on-device before publishing to users.

All previous AI proxy, Cuelume, language models, stats, AppImage-only, and Serv00 uploader behavior remain unchanged.
