# Keyflow Next 2.6.2 — viewport-anchored highlight repair

## User-visible defect

In long right-to-left passages the current-key highlight could appear as a tiny yellow segment at the bottom of the viewport, drift away from the text, or disappear entirely. Version 2.6.1 moved the marker into a full-height scrolling overlay, but WebKitGTK and CSS percentage-height handling could still place it incorrectly. The screenshot demonstrates this bottom-line failure.

## Structural repair

- Keep Persian text in **one uninterrupted RTL text node** for correct contextual Arabic/Persian joining and BiDi shaping.
- Render error/current markers in an independent fixed-position overlay attached to `document.body`, sized and positioned directly from the scrolling passage's `getBoundingClientRect()`.
- Resolve each current grapheme's `Range.getClientRects()` in the same viewport coordinate system. Never add `scrollTop` to viewport-relative coordinates, and never size the overlay from the scroll-content height.
- Explicitly override the old 100%-minimum-height rule and clip visual markers to the actual passage viewport. The historic nested full-height marker CSS has been removed.
- Track scroll events in the capture phase, including the outer `#view` pane; update marker geometry in a **single requestAnimationFrame** instead of on keydown.
- Schedule auto-follow scrolling before highlight repaint to remove one-frame flashes of highlights at the bottom edge.
- Clean up overlay, scroll listener, RAF callbacks, and resize observer when a practice screen is destroyed. Rebind glyph resize observation when a passage changes, resetting scroll to the beginning.

## Verification

- `npm run check`: original functional tests, historical regression audits, module linking, Rust contracts, and Linux AppImage bundler checks.
- `python tests/run-highlight-browser.py`: real Chromium with 1,440 Persian characters, marker/caret alignment at character indices 35, 160, 420, 750, 1430, overlay height equals viewport height, error underline/Backspace cleanup, font zoom, nested outer scrolling, and replacement with another passage.
- The same new browser geometry contract **fails on 2.6.1** (which produces an overlay ~1,659px high over a 205px viewport), and passes on 2.6.2 (overlay 205px high).
- GitHub Actions now runs the browser regression **before** Cargo compilation and AppImage packaging. Final native WebKitGTK rendering on EndeavourOS still needs validation on a real Linux desktop; Chromium is not WebKitGTK.

## Unchanged behavior

The typing engine, adaptive progress, AI and SOCKS proxy, Cuelume audio feedback, EndeavourOS/AppImage-only packaging, and Serv00 artifact uploader remain unchanged.
