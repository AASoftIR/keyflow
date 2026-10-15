# Keyflow 2.1.9

## Text wrapping + audio repair

This release fixes two runtime issues reported from the working EndeavourOS AppImage.

### Practice text wraps again

2.1.8 rendered every normal space as a non-breaking space (`U+00A0`). Because the practice renderer creates one span per grapheme, this accidentally removed all ordinary word-wrap opportunities and WebKitGTK laid an entire passage out as one long line.

2.1.9 keeps the real `U+0020` space, preserves it with `white-space: pre-wrap`, and inserts a zero-cost `<wbr>` after each normal space. Long words also get an `overflow-wrap` fallback. The engine's grapheme/index model is unchanged, so typing accuracy and key highlighting still align exactly with the source text.

### Sound starts immediately

2.1.8 had two UX problems: per-key sound was disabled by default, and Cuelume was loaded through a delayed dynamic import. This made a healthy audio path appear silent and allowed early keystrokes to happen before the module was ready.

2.1.9 statically bundles the pinned `cuelume@0.2.2` module, leaves WebAudio context creation lazy until the actual user gesture, enables the rate-limited per-key tick by default, raises the default volume modestly, migrates the old silent default once, and adds a **Test sound** button in Settings.

No audio initialization is awaited in the typing hot path.
