# Keyflow 2.7.0: Source audit, architecture, implementation plan and verification

**Baseline:** 2.6.2 source archive, not a rewrite.  **Target:** EndeavourOS / Arch Linux using Tauri 2 + WebKitGTK. **Distribution:** AppImage only, uploaded by the existing Serv00 workflow. **Date:** October 2026.

## Executive assessment

The strongest part of Keyflow is its explicit separation between a low-latency keyboard path and the services that require storage, charts or networking. Its main weaknesses were not missing animations or insufficient settings. The remaining faults were mostly lifecycle and data-identity problems: long passages and cursor overlays demand careful geometry; keyboard feedback must never throw into the typing hot path; local text history must survive restarts; and a fresh-looking synthetic deck must not conceal previously used source passages. A typing trainer that violates any of these rules feels unreliable regardless of the number of dashboards it offers.

The 2.7.0 implementation addresses concrete failures with targeted regression tests and adds six training features, a strict freshness scheduler, an expanded built-in library, and a complete native packaging contract. **It is not verified as a native AppImage on the user's actual KDE/WebKitGTK desktop**; that test still must occur after GitHub Actions produces the binary.

## Module-by-module review

| System | Existing implementation | Observed issue / risk | 2.7.0 response |
|---|---|---|---|
| Keyboard loop (`typing-engine.js`) | One DOM text node with deferred overlays; bounded metric buffers | Odd event names and feedback exceptions could interrupt a session; old observers could outlive remounts | Single grapheme filtering; isolated feedback callbacks; cleanup of resize/scroll listeners; explicit sprint finishing |
| Persian display and viewport (`typing-engine.js`, CSS, `viewport.js`) | Contiguous RTL text and viewport-local marker overlay | The high-risk area remains WebKit fractional rectangles, font reflow and mixed LTR/RTL segments | Preserve 2.6.2 renderer; Chromium test through final Persian lines and following replacement/zoom/scroll |
| Passage selection (`shuffle-bag.js`) | Score/penalty-based randomizer using recent IDs and whole fingerprints | Yesterday's source could reappear inside a newly assembled deck; `n-2` protected window and fallback reintroduced repeats | Strict time-based quarantine, stable canonical fingerprints, near-duplicate screening and per-source exposure logging |
| Passage variety (`builtin-texts.js`) | 48 built-in examples, 24 per language | Multiple long sessions exhaust a tiny source pool | 36 additional hand-authored passages; 42 in each language, with more topics and levels |
| Startup (`main.js`, `storage.js`) | Render bundled content before fetching IndexedDB | On cold launch, a previously exhausted bundled pool might hide fresh imported texts | Expand to imported/AI content when built-in freshness runs out; safely cache resolved library rows |
| IndexedDB (`storage.js`) | Indexed sessions and text store, bounded history reads | Full reads on export, potential delayed database open, and storage availability uncertainty | Retain bounded reads in ordinary screens; warn if freshness history cannot persist; keep export as intentional full read |
| Session scoring (`stats.js`, `progression.js`) | Active time and reliability guards | Partial timed passage must not become full-passages personal best or advance adaptive difficulty | Completion reason attached; PB and adaptive difficulty require full passage completion |
| Audio (`audio.js`) | Cuelume 0.2.4 routed through WebKitGTK/GStreamer | An API call returning doesn't prove audible sound on a native Linux system | Truthful “cue requested (unverified)” status; sound exceptions cannot stop typing |
| AI/proxy (`providers.js`, `generator.js`, Rust) | Dynamic model catalogs, quality gate, SOCKS5H proxy, failover | API quality can vary; network/model availability cannot be guaranteed by client code | Preserve the existing provider/proxy architecture; offer generating new practice when fresh built-ins are exhausted |
| Interactive practice (`main.js`, `practice-lab.js`) | Speed, accuracy, key map, coaching | Lacked bounded sprint modes, sectional precision feedback, next-word orientation and saved-passage retrieval | Implement sprint, eight-sector precision meter, word horizon, Zen view and saved-passages Library filter |
| Linux build (`.github/workflows/linux.yml`) | Pinned Rust/JS Tauri 2.12, media-complete AppImage validation, Serv00 uploader | Native AppImage binary and WebKitGTK behavior remain untested here | Keep native CI, dependency contracts, Chromium browser tests and AppImage audit; no DEB/RPM artifacts |

## Confirmed fixes in this release

1. **Silent repetition through composite decks.** The old code tracked the new composite deck ID but permitted reuse when recent-window penalties lost influence. It also allowed older source passages to re-enter before any cooldown had elapsed. Now every selected component is recorded individually; an ID, normalized full-content duplicate, or sufficiently similar source is quarantined during the selected period.
2. **Old text returned as a last-resort fallback.** The old `pool.find(language)` expression guaranteed repetition even when the shuffle bag had run out. It is removed. The application now shows a fresh-pool exhaustion screen and gives explicit next actions.
3. **Legacy history compatibility.** Old `keyflow.seen` records had undated recent tails. Migration now quarantines those tails once, with an expiry, and saves the migration even if no new passage can be selected. The policy avoids a permanent “all sources recent” trap.
4. **Content duplication from new AI or imported IDs.** Fingerprints normalize case, spaces, common punctuation and Persian Arabic letter variants. A shingle comparison screens out near duplicates even when the IDs differ.
5. **Long passage stuffed with old fragments.** If fewer fresh characters remain than requested, Keyflow deliberately uses the shorter fresh material and reports the shortfall.
6. **Unavailable built-ins masking available personal content.** Cold launch initially uses built-ins, but if none are fresh it tries stored personal/AI texts rather than showing a repeated built-in paragraph.
7. **Text cache remained a Promise rather than resolved rows.** The in-flight request is now shared and replaced with its resolved array, so other UI paths can inspect the actual library without another IndexedDB fetch.
8. **Bad keyboard input treated as a printable attempt.** The hot path now checks for exactly one printable grapheme and rejects named or control keys.
9. **Feedback plugin exceptions broke a live typing session.** Sound callback failures are isolated from the typing state machine.
10. **Remounted engine could leave listeners attached.** Resize observers and viewport listeners are explicitly disconnected on remount.
11. **Partial sprints received full-session incentives.** Timed completion has a distinct reason, and only full passages affect adaptive progression and personal bests.
12. **Sound status could mislead.** The display now distinguishes a requested cue from verified audio playback; it does not claim physical audio output was heard.
13. **Local preference save errors could escape.** Settings and seen-history persistence are guarded. Unavailable persistence produces a user-visible warning for freshness history.

## Implemented features

**Timed sprints** — a choice of untimed, 1-, 3-, or 5-minute sessions measured using active typing time. The sprint can finish before the passage ends, without pretending the passage was fully completed.

**Eight-section Precision Map** — color-coded per-section accuracy and a targeted coaching hint. It updates in short batches rather than on every DOM keystroke paint.

**Word Horizon** — next word and remaining word count, using precomputed boundaries and a binary search to avoid rescanning the entire passage each time.

**Zen view** — hides distracting chrome, metrics and the virtual keyboard while retaining typing input and reliable progress tracking.

**Saved Passages** — bookmark a practice passage and find it through the Library's Saved filter; persistence is bounded to prevent uncontrolled growth.

**Progress Recovery Coaching** — recommends slowing down for a high-error section and returning to clean rhythm once accuracy recovers; coaching is grounded in local attempts and mistakes.

**Strict 21-day Fresh Pool (configurable 7/14/21/30/90 days)** — the major request-driven addition. Never silently falls back to recently shown content. Supports explicit Replay, cross-level IDs, near duplicates, first-start import fallback, and reports current fresh supply. Records shown source components rather than composite IDs only.

**Expanded original corpus** — 36 new curated English and Persian texts (18 per language), raising the built-in total from 48 to 84. This is intentionally curated rather than random word salad.

## Performance reasoning and budgets

- Hot path: no calls to IndexedDB, `fetch`, provider discovery, localStorage writes or full-passage re-render inside `keydown`. A feedback failure is handled without aborting the typing step.
- Geometry: marker paints are batched to animation frames; viewport scroll uses the real rendered caret rectangle rather than character intervals.
- Data: recent analytics are capped to bounded windows (typically 120–240 sessions). Full history is fetched intentionally for explicit export.
- Freshness: anti-repeat matching runs **only when selecting a passage**, never when handling a keystroke. It is bounded by the passage library and 640 history records per language; 4-word shingle comparison rejects near duplicates.
- Audio: Cuelume is an optional feedback service, not a dependency of the typing engine's correctness. Its native audibility depends on the WebKitGTK/GStreamer stack and the host sound server.
- Target budgets for subsequent measurements on the user's EndeavourOS laptop: warm keystroke response under 16 ms p95, initial interactive passage under 500 ms without waiting on DB, long-passage marker aligned through the final line, no off-screen markers, stable memory after 20 route changes.

These are **targets**, not asserted measured results on the real machine.

## Verification and exact scope

- Existing 17 functional tests, 23 audit checks, viewport/highlight contracts, and packaging checks still pass.
- Eleven strict freshness tests: simulated consecutive days, changed content IDs, near duplicates, multi-component decks, exhaustion, explicit replay, historical migration, expiration, language independence and identical imported content.
- Real Chromium smoke with 1,440 Persian characters: verifies glyph run integrity and caret visibility near the end, outer scrolling, zoom, passage replacement, sound callback fault tolerance and partial sprint finish.
- No completed native `cargo tauri build` or WebKitGTK audio / video / keyboard measurement in this environment. Run the repository's native GitHub Actions build and smoke test on actual EndeavourOS before calling it a fully verified release.

## Roadmap to a truly exceptional typing application

### Phase A: correctness and trust (delivered in 2.7)

Strict freshness, predictable keyboard semantics, safe Persian text shaping, responsive scrolling, truthful timing and audio states, bounded storage, deterministic tests and reliable AppImage distribution.

### Phase B: deeper learning science (proposed, not yet implemented)

Introduce a spaced-repetition **skill** scheduler distinct from repeating whole passages, with mastery confidence intervals per grapheme transition. Use high-quality sentences containing weak pairs instead of recycling completed essays. Add a personalized fatigue model, 30-second ergonomic microbreaks, difficulty calibration against recent sustained WPM, and a transparent skill-tree explanation.

### Phase C: content studio and community (proposed, not yet implemented)

Long-form original literary/public-domain collections with reliable rights metadata, teacher-curated Persian corpora, personal corpus import from text PDFs without OCR, semantic duplicate detection for AI drafts, local draft queue and offline daily challenges. Any community feature should require explicit opt-in before sending typing history off-device.

### Phase D: native UX quality and release tests (proposed, not yet implemented)

A WebKitGTK/EGL diagnostic suite run on the target EndeavourOS hardware, proper GStreamer sink playback confirmation, KDE native theme integration, accessibility and high-contrast testing, CPU/profiling traces from long Persian sessions, and integration tests that launch and operate the **actual built AppImage**.

### Phase E: polished product experience (proposed, not yet implemented)

An on-screen personal keyboard map with calibrated finger paths; semantic mistake replay with a clear consent switch; goal journeys with meaningful levels; word rhythm graphs; localized screen-reader cues; portable local backup/restore with migrations and integrity checks.

**Design principle:** performance and correctness first; no decorative 3D or motion in the typing hot path. New features must have regression tests and concrete user value.
