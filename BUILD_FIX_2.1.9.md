# Keyflow 2.1.9 runtime fix

## Practice text was one unbreakable line

The renderer replaced every ordinary space with `U+00A0` (NBSP). With one span per grapheme that removed normal browser word-break opportunities, so WebKitGTK correctly treated the passage as a single unbreakable run.

2.1.9 renders the real space character, keeps `white-space: pre-wrap`, adds a `<wbr>` after spaces, and retains an `overflow-wrap` fallback for unusually long tokens.

## Sound appeared dead

Two independent choices combined badly in 2.1.8:

1. `keySounds` defaulted to `false`, so normal correct typing was intentionally silent.
2. Cuelume arrived through a delayed dynamic import, while error cues were also mixed at a very low effective volume.

2.1.9 statically bundles pinned `cuelume@0.2.2`, keeps AudioContext creation lazy until a real user gesture, turns the rate-limited typing tick on by default, migrates the old silent default once, raises cue levels, applies sound switches immediately, and adds a Settings **Test sound** control.

The key handler still performs no storage, network, database, or awaited async work.
