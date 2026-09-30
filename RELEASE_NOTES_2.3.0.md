# Keyflow 2.3.0 — Persian Safe Renderer + Direct Audio Coach

## Persian rendering

Persian practice text now uses a plain uninterrupted text node in one RTL block. WebKitGTK Custom Highlights are disabled specifically for Persian because highlighting a sub-range can reshape Arabic joining clusters. Correct/current/error feedback is drawn as a separate geometric underlay, so it never changes the glyph run. The Persian text layer also disables the old GPU/compositing transform and uses normal bidi paragraph behavior.

## Sound that actually plays on keys

The typing hot path now owns its own `AudioContext({ latencyHint: 'interactive' })`. It does not depend on Cuelume's `navigator.userActivation.hasBeenActive` guard, which can remain false inside some WebKitGTK/Tauri environments. The first real keydown resumes the context and queues its cue immediately. Cuelume remains only as optional decorative polish for ready/completion cues.

Three sound profiles are included: Mechanical, Soft, and Minimal. Practice shows the live audio state (`armed`, `running`, or failed) and Settings has a test button that uses the exact same audio path as real keystrokes.

## New training features

- physical finger/hand hint for the next key;
- live clean-key streak;
- one-click Retry for the same passage;
- one-click Accuracy Lock in the practice toolbar;
- audio backend monitor in practice/settings;
- three selectable key-sound profiles;
- Training Lab cards for Finger Coach, Audio Monitor, and Accuracy Lock.

## Performance

Persian no longer uses CSS Custom Highlights or a `translateZ(0)` compositing layer. The text itself is never rewritten while typing; only small absolutely positioned marker rectangles are updated.
