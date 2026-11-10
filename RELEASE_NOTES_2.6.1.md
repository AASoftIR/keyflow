# Keyflow Next 2.6.1 — Scrolling Highlight Regression Fix

**Fixed:** On long Persian passages, the current-character marker became a thin line or disappeared after the passage scrolled. The old marker layer had `overflow: hidden` and was sized to the *scroll viewport*, while markers were located at the positions of characters in the full scrollable passage. Markers beyond the first visible portion were clipped.

### Changes

- A `.typing-content-layer` now holds **both** the uninterrupted Persian glyph text and the marker overlay in the same full-height scrolling coordinate system.
- Marker positions are derived from their overlay bounding rectangle, not from the viewport plus scroll offsets.
- The overlay is never itself a clipping container. The text viewport remains the only element that clips scrolled content.
- Resize and font reflow invalidates marker geometry without splitting the Persian text into individual spans.
- The browser regression covers positions 35, 160, 420, 750 and the last ten characters in a 1,440-character Persian passage, mistake/highlight + Backspace cleanup, and font zoom reflow.
- Added an always-on, dependency-free highlight architecture contract to `npm run check`.

### Validation

`npm run check` passed, and `python tests/run-highlight-browser.py` passed with real headless Chromium. The new browser regression fails against the original 2.6.0 source, confirming it catches the reported bug.

A real EndeavourOS WebKitGTK AppImage was not executed in the test environment. GitHub Actions remains responsible for the native build and Serv00 distribution.
