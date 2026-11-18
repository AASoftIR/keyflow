# Build/runtime fix 2.3.0

This release addresses two runtime problems seen on EndeavourOS/WebKitGTK:

1. Persian contextual shaping could still break even with a single Text node because CSS Custom Highlight ranges caused WebKitGTK to repaint the selected joining cluster separately. Persian now always uses geometry-only markers and the glyph run is never styled per-character.
2. Cuelume 0.2.2 checks `navigator.userActivation.hasBeenActive` before creating/playing WebAudio. Some Tauri/WebKitGTK environments can report that flag as false despite real keyboard input, resulting in complete silence. Real typing cues now use Keyflow's own interactive AudioContext without that gate.
