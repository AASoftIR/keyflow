# Keyflow 2.5.0 — independent code audit and implementation

**Basis:** complete Keyflow 2.4.0 source ZIP, not screenshots or a recreated project.
**Target:** EndeavourOS / Arch Linux; AppImage only; existing Serv00 uploader maintained.

## Confirmed defects / potential failures fixed

| ID | Area | Problem in 2.4.0 | 2.5.0 change | Regression evidence |
|---|---|---|---|---|
| B01 | IndexedDB | Rejected `dbPromise` stayed cached forever, preventing further storage attempts | Failed opens reset `dbPromise`; blocked database and version changes handled | IndexedDB retry test |
| B02 | IndexedDB | Transactions could abort with no rejection handler, leaving an awaiting screen blocked | `onabort`, `onerror`, and complete handlers; request cursor abort errors | Source inspection + storage tests |
| B03 | Settings | `null`, arrays, or corrupted calibration in localStorage could break load/render | Shape and range validation for settings, mappings, progression, seen history, and provider config | Corrupt-settings tests |
| B04 | Credentials | Saving empty credentials did not remove an existing session key | Clear `sessionStorage` for blank explicitly-saved key; never persist keys to localStorage | Provider key test |
| B05 | AI catalog | Model discovery cache replaced every API key with `*`; switching accounts reused the wrong catalog | Account-/proxy-specific in-memory cache keys | Stub HTTP discovery test |
| B06 | Custom API | Custom model/chat path concatenation omitted separator for paths without leading `/` | Central relative URL joiner; reject second absolute origin | API URL tests |
| B07 | AI validation | Mutating `validation.issues` for a mismatched output language still left `validation.ok=true` | Accept only when issues are empty as well as base validation okay | Wrong-language repair test |
| B08 | AI validation | Exact same `validation.ok` oversight accepted highly duplicated AI text | Block draft and require repair/fallback on phrase overlap | Duplicate repair test |
| B09 | Text scheduling | A missing topic tag silently fell back to unrelated passages; combining two specialized decks could select overlapping content | Enforce requested tag; exclude first deck source IDs from second pass | Deck exclusion and missing-tag tests |
| B10 | Timing | Negative/out-of-order monotonic timestamps could still be accepted when reported active duration was plausible | Validate chronological key order before making a PB or calculating reliable WPM | Timing anomaly test |
| B11 | WebKit performance | Persian mistake highlights and the current marker measured DOM geometry synchronously inside every keydown | Frame-coalesced geometry painter, bounded historical DOM markers, no Range allocation on correct Persian keystrokes | Hot-path source audit and Persian DOM smoke |
| B12 | UX timing | Elapsed timer stopped updating whenever the user was not pressing keys | Low-frequency active-only timer driving batched progress updates | Timed refresh contract |
| B13 | Correction state | Backspace left the clean-key streak and pair context intact | Reset streak and restore previous expected pair on backspace | Code review |
| B14 | Navigation | Rapid route switching could allow older pending async data loads to overwrite a newer view | Per-route serial guard applied to Practice, Progress, Library, AI, Lab | Navigation wiring audit |
| B15 | AI UX | Older provider's slow model-discovery request could overwrite a newly chosen provider | Per-discovery serial + provider identity guard | UI integration audit |
| B16 | Content quality | Local user texts could be saved even when content validator found unmapped characters or language problems | Require successful validation before adding to library | Content pipeline change |
| B17 | Completion | Session save rejection prevented the completion screen from rendering | Save errors are caught; completion remains available and XP is not credited for unsaved sessions | Completion path review |
| B18 | Network security | Native HTTP adapter followed redirects, potentially forwarding custom authorization headers | Disable native request redirects | Rust source audit |
| B19 | Statistics | WPM penalized *all* historic wrong attempts even when a user fixed them | Store unresolved mistakes separately; score net WPM against unresolved mistakes; keep raw mistakes in accuracy | Corrected-error scoring test |
| B20 | Feature integrity | Recycled passage under a new dynamic deck ID counted as another unique daily quest | Daily variety now deduplicates normalized text content | Duplicate-ID quest test |
| B21 | Library shortage | A selected short source could silently claim to satisfy an endurance target | Expose an explicit `shortfallChars` field if the source pool cannot cover the requested length | Length-shortfall test |
| B22 | Sound diagnostics | Requested cues were labeled “active,” falsely suggesting audible playback even when Linux GStreamer is not operational | Distinguish `sent` cue requests from verified sound output | Source audit |
| B23 | Mistake display | Backspace reset a key's mistake status before checking it, so the stale red error marker could remain on the passage | Capture the previous status before clearing it and remove its marker | Backspace marker regression test |

## Six new, functional training features

1. **Live target-pace ghost:** progress track draws a target trajectory at the configured WPM. The coach reports characters behind/ahead and uses actual active time.
2. **Estimated completion time:** computed only after a sustainable warm-up sample (avoids a meaningless value from the first few keypresses).
3. **Intentional microbreak:** dedicated **Take a break** control pauses the active timer and typing capture without throwing away the passage.
4. **Mistake Microscope:** after finishing, inspect the specific words and positions containing wrong keys. A button makes a focused practice drill from those words.
5. **Daily quests:** three grounded daily challenges (active minutes, a clean run, and real passage variety). Only reliable recorded sessions count, and repeated text under different IDs counts once.
6. **Session compare + error timeline:** compare WPM, accuracy and consistency to the previous valid run, and view which portion of the last passage caused errors in Training Lab.

## Performance, Persian, audio and privacy

- Original safe Persian single-text-node shaping remains intact.
- Geometry underlays are now frame-batched, so each key does not synchronously force layout.
- A timer refreshes the active elapsed display at 2 Hz rather than with expensive high-frequency metrics recomputations.
- Cuelume remains the sound engine. A `sent` cue status is not proof of an audible Linux/GStreamer output path; check the system output in the real AppImage.
- Local API keys remain in `sessionStorage`, are omitted from persisted provider settings, and are never included in exports.
- Native HTTP redirect policy is now `none` to avoid carrying custom credentials across redirects.

## Tests performed here

- `npm run check` passed: **17 original functional cases**, **23 new audited functional/regression cases**, Persian DOM smoke, Cuelume adapter smoke, 16-app-module import/export check, Rust source contract, Tauri version contract, AppImage runtime audit cases, and CI contract.
- `node --check` passed for all application, script, and test JavaScript/MJS sources.
- A native AppImage compile was **not executed**: this container does not have a Rust toolchain. `npm install` could not reach npmjs.org (`EAI_AGAIN`). Therefore Vite production build, GUI behavior in WebKitGTK, audible GStreamer output, and the final binary have **not been independently verified here**. GitHub Actions remains responsible for these steps.
- An attempted Chromium smoke run hung in this container and is **not counted** as a passed browser test.

## To validate on EndeavourOS

```bash
npm install
npm run check
npm run build
npm run tauri:build
```

Use the AppImage produced by the existing GitHub workflow. Confirm both Persian joining and actual audible Cuelume/GStreamer output manually on the target KDE desktop. AppImage is the only packaged Linux format; CI continues to upload it and `SHA256SUMS.txt` to the existing Serv00 endpoint.
