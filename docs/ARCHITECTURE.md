# Keyflow latency architecture

## Hot path budget

The keystroke handler is designed around a strict rule: anything that can wait must wait.

`keydown -> normalize -> compare -> record in memory -> mutate current glyph -> queue metric paint`

No storage, network, model calls, chart work, or full DOM tree regeneration is allowed in that path.

### Why the previous symptom happens

When a UI framework updates large text arrays, stats, keyboard state, audio, and persistence from the same key event, work can exceed the ~16.7 ms frame budget. Once events queue, the visible caret/highlight trails the user's real typing. The app then feels as if it “accepted the key seconds ago but rendered later.”

### Keyflow approach

- Passage graphemes are materialized once.
- Only one old and one current glyph are touched.
- Aggregate labels update at most once per animation frame.
- Layout-learning writes only when a character's physical mapping changes.
- Session database write is one transaction after completion.
- Audio is fire-and-forget and per-key ticks are opt-in.
- Text viewport layout is sampled sparsely, not per key.

## Keyboard correctness model

Static character-to-key tables cannot fully solve Persian layouts. The authoritative observation is the browser/WebView event pair:

```text
KeyboardEvent.code = physical switch position
KeyboardEvent.key  = character emitted by the active OS layout
```

The learned map is therefore `character -> { code, modifiers }`. It overrides the selected fallback profile.

## AI boundary

The frontend owns provider configuration and text quality logic. The Rust shell only performs bounded HTTP requests. This keeps the native bridge provider-agnostic while avoiding CORS failures.

## EndeavourOS WebKitGTK renderer policy

Tauri's Linux webview is WebKitGTK. Keyflow 2.1 applies its graphics environment before `tauri::Builder` creates the webview. EndeavourOS defaults to the DMABUF-safe renderer because a blank/dark surface is worse than the small presentation-path cost in a deliberately lightweight typing UI. `KEYFLOW_RENDERER` can force native, full software-safe, or X11-safe behavior for diagnosis.

The frontend does not use WebGL for practice, charts, or the keyboard. Ultra mode also removes blur-heavy/composited decoration, so disabling the problematic DMABUF path does not move expensive 3D rendering onto the CPU.

## Bounded analytics reads

IndexedDB schema v2 adds a compound `languageStartedAt` index. Practice/adaptive surfaces request only a bounded recent history, while the Progress screen can still calculate full historical aggregates. This keeps the latency-critical screen fast even after months of daily sessions.

## Physical weakness heatmap

The heatmap is calculated when a screen opens, not while keys are being processed. Character weakness scores are resolved through the selected/self-learned `KeyboardMapper` into physical `KeyboardEvent.code` positions and converted to four static keycap classes. No heatmap computation occurs in `keydown`.
