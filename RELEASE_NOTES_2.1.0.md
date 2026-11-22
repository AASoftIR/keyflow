# Keyflow Next 2.1.0 — EndeavourOS performance release

## Dark AppImage / WebKitGTK

- Identified the Linux desktop stack correctly: Tauri uses WebKitGTK, not Qt.
- EndeavourOS now starts with the DMABUF-safe WebKit renderer on X11 and Wayland.
- NVIDIA/Wayland receives the explicit-sync compatibility environment when detected.
- Added `KEYFLOW_RENDERER=normal|software|x11-safe` troubleshooting overrides.
- Added `~/.local/state/keyflow/startup.log` runtime diagnostics.
- Kept the custom movable/resizable Tauri window with explicit native drag/resize hit zones.

## Packaging

- AppImage is the only bundle target.
- CI builds in current Arch userspace to match EndeavourOS closely.
- No distro-specific Debian/RPM artifact is produced or uploaded.

## Performance

- O(1) rolling consistency and input-delay windows.
- Coalesced hint and metric updates.
- Deferred passage recentering outside the keydown handler.
- Cuelume warm-up after first paint; no async audio imports from keydown.
- Ultra latency rendering mode removes blur, large shadows and glyph transitions.
- CSS containment around the high-frequency practice surfaces.
- IndexedDB schema v2 adds `[language, startedAt]` for bounded recent-session queries.
- Practice uses a bounded recent history for weakness heatmaps and adaptive drills.

## Persian input correctness

- Rebuilt `ir(pes)` from the actual EndeavourOS/XKB symbols file.
- Corrected the separate `ir(winkeys)` profile, including Persian marks and AltGr levels.
- Added guided calibration and passive self-learning from actual browser keyboard events.

## New training features

- physical weak-key heatmap;
- numbers/symbols mode;
- adaptive difficulty;
- personal best detection;
- one-click Retry Mistakes recovery drill;
- Next Useful Session coach;
- responsiveness audit;
- expanded Training Lab actions.

## AI fixes

- live model discovery remains the source of truth;
- fixed Smart Pick word-boundary matching;
- fixed zero-price OpenRouter model detection for numeric `0` values;
- custom OpenAI-compatible endpoints may be keyless;
- added response-path configuration;
- added optional second-pass deep grammar/story review with full revalidation afterward.
