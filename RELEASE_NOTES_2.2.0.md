# Keyflow 2.2.0

## Persian shaping fixed at the renderer level

The old practice renderer created one DOM `<span>` per grapheme. That is acceptable for Latin text but it splits the cursive shaping run used by Persian/Arabic in WebKitGTK, so letters can appear disconnected or visually reordered.

2.2.0 keeps the complete passage in one `Text` node with `dir=rtl`, `lang=fa`, `unicode-bidi: plaintext`, zero Persian letter spacing, and contextual ligatures enabled. Correct/current/wrong state is painted with the CSS Custom Highlight API. A geometry-only marker fallback is used when Custom Highlights are unavailable, so the DOM text itself is never split. Replay uses the same shaping-safe principle.

## Audio Coach is now visible and useful

The practice card now exposes an Audio Coach control beside the legend. Its cue vocabulary is intentionally distinct:

- clean key: crisp `tick`;
- word/space boundary: `pulse` for rhythm;
- mistake: strong low `error`;
- session complete: `success`.

Default volume is raised to 0.72, the test button demonstrates all cue categories, and older quiet default settings are migrated without overriding explicit on/off choices from 2.1.9.

## Regression guards

CI now rejects per-grapheme practice spans, requires the single text-node renderer and Custom Highlight paint layer, verifies Persian bidi/letter-spacing CSS, and requires the word-boundary Cuelume cue and visible Audio Coach control.
