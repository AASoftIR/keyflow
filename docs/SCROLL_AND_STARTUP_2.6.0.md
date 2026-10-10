# Keyflow 2.6.0 — viewport, startup, and responsiveness audit

## Failure diagnosis

1. The old practice text had `height:220px` and `overflow:hidden`. Beyond the visible area the next Persian line disappeared.
2. `_syncCurrent` scheduled cursor-follow **only every 36 graphemes** (or newline). Grapheme count does not reflect rendered lines, notably with proportional RTL Persian.
3. Progress/highlight paints did not reliably compensate for a moving scrolled container.
4. Route-to-practice could await `indexedDB.open()` for custom texts before rendering, making a KDE/WebKitGTK cold start appear frozen.
5. Native runtime diagnostics were also awaited before the first screen.
6. An old `requestIdleCallback({timeout:1200})` could force heavy history aggregation during active typing.
7. Manual mouse wheel browsing had no explicit follow/recovery behavior.
8. App controls could consume typing events when focused because `<button>` wasn't excluded from typing capture.
9. Stale completion can reopen after navigation during asynchronous session save.
10. Long inactivity could count against active typing until the user manually paused, biasing pace.

## Repairs

- True overflow-y scrolling, with an accessible scroll region and visible thin scrollbar.
- Caret follows the viewport's safe band on every animation frame **only when needed**. No synchronous Range measurements from the keydown handler; zero measurements for a passage that fits entirely.
- Scroll target function clamped by `scrollHeight-clientHeight`, independently unit-tested for overflow and reverse movement.
- `ResizeObserver` repositions after changes in geometry/zoom.
- Mouse wheel cancels auto-follow; `Current key` recovers it explicitly.
- Built-in text launches immediately without awaiting IndexedDB; personal library preloads opportunistically on idle.
- Native runtime diagnostics load in the background. Historical heatmap waits for a gap in typing.
- Timer-based idle pause is opt-in-configurable, never fires before first typed key, and preserves active-time accounting.
- Controls aren't accidentally typed into the passage when focused.
- Complete teardown cancels RAF/timers/ResizeObserver/listeners; modal rendering is route-guarded.

## Six interaction features

1. **Auto-follow** toggle per user preference.
2. **Return to current key** button and automatic focus restoration.
3. **Previous/next page browsing** without disturbing recorded typing progress.
4. **Readable passage zoom** (80–155%, persistent; user can change while typing).
5. **Automatic idle break** (0 / 30 / 45 / 60 / 90 seconds), with a safe resume button.
6. **Segment navigator**, dividing long practice decks into approximately 160-grapheme sections, showing part count and percentage.

## Verification scope

`npm test` runs existing 17 tests, 23 audit checks, two smoke suites, plus V2.6 scroll and integration contracts. The real Chromium smoke test `python tests/run-viewport-browser.py` **PASSED** here with a 1,280-character Persian passage. At 35 / 160 / 420 typed characters the viewport scrollTop was 0 / 51 / 370 px, and the caret remained in view. The included test runs directly via Playwright and module data URLs, without npm or a localhost server. The final WebKitGTK AppImage should be smoke-tested on EndeavourOS/KDE before publication.

Native packaging remains AppImage-only. CI Serv00 uploads are not changed.

## Verified versus unverified

- **Passed:** 17 baseline tests, 23 previous audit tests, 6 viewport unit cases, 12 source integration assertions, real Chromium 1280-character Persian scroll test, import/export graph, Rust source contract, Tauri version contract, AppImage audit fixtures.
- **Not run in this sandbox:** native `cargo tauri build`, WebKitGTK actual-window testing on EndeavourOS, production `vite build` (the npm dependencies could not be fetched). Actual startup timing on KDE/X11/Wayland needs a native smoke run; source changes eliminate two synchronous wait points but do not guarantee a specific startup time.
