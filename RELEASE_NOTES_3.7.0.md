# KeyFlow Next 3.7.0 — Frame-Stable Typing and Correction-Aware Replay

This release focuses on the core input/rendering path, cold-start contention, and genuinely useful practice diagnostics. It is a complete source release built on the existing v3.6 bilingual Tauri application; it keeps the AI mission system, Dahl/OpenRouter/Groq integrations, local voice coach, Data Vault, AI draft recovery, time trials and completion-only text tracking.

## 1. Persian caret and wrong-key rendering recode

Previously, a Persian keystroke could scan backward over every character already typed to locate recent green highlights, even though only three were ever shown. A 4,000-character session would eventually do thousands of status reads on each paint. The old marker lifecycle also created and removed DOM nodes as errors moved out of view. The new implementation:

- Reuses **one current-key marker, three correct-key markers, and twelve wrong-key markers** for the whole passage. Marker nodes are created at passage render time and reused through the session.
- Looks backward at most **18 recently typed status cells** for the green markers, and maintains a bounded 30-entry map of recent incorrect physical inputs. Older errors remain in the session's statistics even when not visible as glyph overlays.
- Measures text Range rectangles in a single read phase before adjusting any marker styles, reducing unnecessary synchronous layout flushes in WebKitGTK.
- Avoids redundant style property writes when coordinates have not changed. The body-attached viewport overlay remains separate from the one-text-node Persian glyph run, so Arabic joining and line wraps are not broken by split spans.
- Coalesces marker, scroll and resize work with existing animation-frame scheduling. No polling loop is added.

The existing **Pressed / Expected** mistake banner remains visible; this release does not require tooltips to discover which incorrect key was entered.

## 2. Faster first-keystroke path

- The first expensive fresh-pool calculation is scheduled only after a longer idle delay and is skipped if the user is already typing.
- A legacy session-history migration that could load thousands of sessions at startup has been moved out of the cold-start path. It still runs when an actually exhausted deck needs repair, or after a completed session if legacy records remain.
- Personal-best ghost history now waits for an idle window; if IndexedDB finishes loading after typing starts, it postpones the expensive comparison instead of interrupting the typing burst.
- Keyboard heatmap aggregation checks for new typing activity *after* its database request settles, too. A late database response no longer triggers a mid-burst aggregation.
- Grapheme segmentation instances are shared per language; the keyboard layout mapper caches chord hints and invalidates them as soon as a learned physical key changes.
- The no-repeat selection path pre-indexes recent IDs, fingerprints and content shingles before evaluating passage candidates. Exact cooldown, partial-session and near-duplicate rules are preserved.

These optimizations target the application-side costs. They cannot eliminate OS/compositor GPU stalls, a missing WebKitGTK media backend or slow network requests from an external AI provider.

## 3. New: configurable upcoming-key preview

**Practice → Options → Look ahead** offers **Off, 2, 4, or 6 keys**. A small, fixed-height strip appears between the immediate current-key ribbon and passage. It shows the keys *after* the current key, rendering Space as `␣`, Enter as `↵`, Tab as `⇥` and Persian zero-width non-joiner as `ZWNJ`. This is a peripheral preview: the existing large **NEXT / PRESS / FINGER** ribbon remains the immediate guide. A stable-height element prevents character-by-character reflow. The preference survives restart via settings schema **16**.

## 4. New: opt-in frame stability probes

Practice contains an **8-second frame probe**. Open Settings → Responsiveness for a **6-second probe** and a history of the twelve most recent measurements. Both are disabled by default and run only after clicking the button. Each uses one `requestAnimationFrame` loop, supports cancellation and stops on hidden windows or navigation.

The probe reports average frame rate, p95 frame time, worst frame and long-frame count (>50 ms). A steady low frame rate is classified as janky rather than being incorrectly called stable simply because there were no irregular spikes. The last 12 summaries stay in local settings storage, are included in Data Vault exports, and can be compared between Ultra/Balanced mode or window sizes.

**Interpretation:** A high p95 frame time means the UI was not getting regular animation frames; it does **not** conclusively identify JavaScript versus GPU/compositor scheduling. Input-event delay (already separately displayed in Practice/Progress) helps triangulate the cause.

## 5. Session replay: one scheduler, real time and corrected errors

Earlier playback could schedule up to 2,500 individual timeouts. This release builds an indexed timeline once and drives playback with a **single animation frame**. It adds:

- **Play/pause**, manual **previous / next key**, a **seek slider**, **0.5× / 1× / 2× / 4×** speed, and an optional auto-follow switch.
- Entire recorded sessions can be replayed up to 15,000 events without truncating all timestamps to a 20-second window. Seek is binary-search based, not linear in the number of keystrokes.
- A true correction-aware mistake state: Backspace removes the old red marker and a successful repair in Strict mode clears the corresponding active mistake.
- A viewport-relative cursor and recent mistakes over a single uninterrupted Persian/English passage node; geometry reads are batched before marker style writes. All playback RAFs and listeners are torn down when the modal closes.
- Live action counters for keys, errors and Backspace presses, with last-key feedback.

Old sessions with no recorded key events can still lack replay data; the app explains that instead of inventing playback. The replay view is an inspection tool and does not change historical results.

## 6. Compatibility and validation

- Full source version is **3.7.0** in the package, Tauri configuration and Rust package manifest.
- Settings migration **15 → 16** adds the opt-in look-ahead preference without resetting AI credentials or prior practice history. Data Vault includes local frame-probe history.
- `npm run check` exercises the prior regressions, module export resolution, Tauri/Rust source contracts, AppImage runtime audit, and new v3.7 tests.
- v3.7 tests cover a 4,000-character Persian fake-DOM renderer under 120 repaint requests: a bounded number of status reads, fixed 16-element marker pool and limited Range allocations. Replay includes a simulated 12,000-action session, error correction/Backspace checks, speed-independent seek and controller cleanup. The frame profiler is tested with synthetic timestamps and cancellation.

### Important test limitation

The deterministic Node regression suite passed. The available execution environment prevented Chromium from creating a socket (`socket(): Operation not permitted`), so native WebKitGTK/EndeavourOS frame timing and visual resizing were **not** measured here. A browser or AppImage smoke run on your actual computer is still necessary. The included browser and runtime test scripts remain available for that step.

### Practical validation on EndeavourOS

1. Back up with **Lab → Private Data Vault** before replacing a live build.
2. Open a narrow window with Persian selected, paste a long saved passage or choose Endurance, and type at normal speed for 60–90 seconds. Watch the red/green current marker and verify it stays anchored during font zoom, text wrapping, scroll and panel toggles.
3. Run the frame probe while actually typing and repeat in Ultra mode with animations disabled. Note frame p95 and the existing **input p95** separately.
4. Complete a passage with at least one mistake and Backspace, open **Replay keystrokes**, seek backward, correct again, pause and step through. The red marker should disappear at the correction.
5. Change Look ahead to 0/2/4/6 and restart to verify the chosen value persists.

## Work still worth doing

This is a major optimization/refactor of the existing application rather than a literal rewrite from zero. A platform-specific GPU or WebKitGTK frame stall can only be reliably diagnosed from a run on that system. AI text-generation reliability still depends on provider quotas, model behavior, writable local storage and whether the selected model returns actual assistant text; the previous bounded fallback, credentials, draft persistence and local prompt generation remain in place, but no provider can promise every remote model will work.
