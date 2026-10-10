# Keyflow Next 2.6.0

**New:** real RTL long-passage scrolling, reliable per-frame caret follow, startup without waiting for IndexedDB, manual passage browsing, persistent text zoom, idle breaks, section navigation. See [`docs/SCROLL_AND_STARTUP_2.6.0.md`](docs/SCROLL_AND_STARTUP_2.6.0.md).

# Keyflow Next 2.5.0 — EndeavourOS Edition

> **2.5.0 reliability + progression release:** impossible timing samples can no longer create million-WPM personal bests; live WPM waits for a meaningful warm-up and uses the same net formula as completion. Practice uses a global smart deck with stronger anti-repeat rotation, real level-first selection, longer Standard/Long/Endurance targets, permanent XP/ranks, three-session curriculum guidance, expanded flow/hand/pause/reliability stats, native HTTP(S)/SOCKS5/SOCKS5H AI proxy support (preset for `127.0.0.1:10808`), live-model fallback, AI duplicate rejection, and a calmer Cuelume sound mix. Historical heatmap work is deferred to idle time, and transient WebKitGTK startup blur no longer pauses an untouched session.

> **2.2.0 Persian shaping + audio-coach fix:** Persian practice text is now rendered as one uninterrupted text node so Arabic cursive joining and bidi ordering are preserved on WebKitGTK. Per-character state is painted with CSS Custom Highlights instead of per-letter DOM spans. The visible Audio Coach now uses distinct key, word-boundary, mistake, and completion cues.


> **2.1.8 audit correction:** 2.1.7's app actually compiled and packaged; CI rejected it because our own audit mistakenly classified `libwayland-egl` and `libwayland-cursor` as fatal. The confirmed Mesa breaker is bundled `libwayland-client`; 2.1.8 tests this distinction explicitly. EndeavourOS AppImage runs also use WebKitGTK software compositing for maximum blank-window resilience.

> **2.1.8 / EndeavourOS:** this release uses Tauri 2.12's repaired AppImage bundler and CI-audits the extracted image so Ubuntu build-host Wayland/EGL libraries cannot shadow the rolling Mesa stack on EndeavourOS.


> **2.1.8 runtime fix:** the complete Tauri 2.12 Rust/JS/CLI family is exact-pinned. CI extracts the finished AppImage and rejects the confirmed Mesa-breaking libwayland-client and driver ABI libraries, plus an old forced-X11 AppRun hook before Serv00 upload.


Low-latency Persian + English touch-typing trainer built specifically around the supplied Keyflow UI and the user's EndeavourOS desktop workflow.

This repository is a clean replacement architecture because the original Keyflow source archive was not supplied with the screenshots. It is not a line-by-line patch of unknown source.

## Primary platform

**EndeavourOS / Arch userspace is the primary and only packaged Linux target.**

Release packaging emits **AppImage only**. There are no Debian or RPM artifacts in the build workflow.

```bash
npm run tauri:build
```

Output:

```text
src-tauri/target/release/bundle/appimage/*.AppImage
```


## 2.1.5: native Rust lifetime fix

The Linux GPU detector now keeps normalized PCI vendor IDs in owned `String` values before matching. This removes the Rust E0716 temporary-borrow failure that occurred after the frontend had already built successfully. CI also runs `cargo check` before full AppImage packaging and keeps the existing Serv00-only upload path.

## 2.1.2: Vite/Rollup module-link fix

The keyboard UI now imports the canonical `PHYSICAL_ROWS` export from `app/core/layouts.js`. A `KEY_ROWS` compatibility alias remains so older modules cannot recreate the same failure. `npm run check` now includes an ESM module-contract pass that syntax-checks every app module and verifies every relative named/default import exists before the expensive Tauri build starts.

## 2.1.8: EndeavourOS AppImage EGL fix

Tauri on Linux renders the frontend with **WebKitGTK**, not Qt. The 2.1.6 blank window was not a CSS/frontend problem: the old Tauri 2.11 AppImage bundler could ship build-host Wayland/graphics ABI libraries that shadow the newer rolling Mesa stack on EndeavourOS. The WebKit child process then aborted during EGL initialization, leaving only the GTK shell window.

Keyflow now packages with Tauri 2.12.0, whose updated linuxdeploy/GTK integration fixes that AppImage class. The runtime compatibility layer is still retained as a second line of defense:

- EndeavourOS: `WEBKIT_DISABLE_DMABUF_RENDERER=1` on both X11 and Wayland.
- NVIDIA + Wayland: also applies `__NV_DISABLE_EXPLICIT_SYNC=1` when appropriate.
- Other Arch-family KDE/Wayland systems: DMABUF-safe path.
- The app records the chosen path in `~/.local/state/keyflow/startup.log`.

Troubleshooting overrides remain available:

```bash
KEYFLOW_RENDERER=normal ./Keyflow.AppImage
KEYFLOW_RENDERER=software ./Keyflow.AppImage
KEYFLOW_RENDERER=x11-safe ./Keyflow.AppImage
```

`software` is the last-resort path and also disables WebKit accelerated compositing. Normal EndeavourOS use should not need it.

## Typing latency architecture

The keydown path contains no database reads, network calls, AI calls, chart work, JSON parsing, dynamic imports, or full-passage rerenders.

A printable key performs only:

1. Unicode normalization.
2. Expected/actual comparison.
3. O(1) rolling timing updates.
4. Mutation of the previous/current glyph.
5. Physical-key mapping observation.
6. A coalesced `requestAnimationFrame` metrics update.

Additional performance work:

- input event-queue p95 is measured separately from finger rhythm;
- paragraph scrolling is deferred/coalesced instead of forcing layout in `keydown`;
- consistency uses an O(1) rolling variance window;
- Cuelume is warmed after first paint and never dynamically imported from a keystroke;
- optional per-key sound is rate limited and off by default;
- Ultra mode removes backdrop blur, large shadows, glyph transitions and unnecessary compositing;
- typing/keyboard/metrics regions use CSS containment;
- IndexedDB v2 adds a compound `[language, startedAt]` index so adaptive practice can query recent language-specific sessions instead of loading the entire history.

## Correct Persian keyboard mapping on EndeavourOS

The Persian mapping is derived from the installed Linux XKB definitions in `/usr/share/X11/xkb/symbols/ir`.

Included profiles:

- **Persian / XKB Standard `ir(pes)`** — recommended on EndeavourOS.
- **Persian / XKB Windows compatibility `ir(winkeys)`**.
- English US.

Important examples from the standard XKB profile:

- `پ` -> physical `M`
- `ک` -> physical `;`
- `:` -> `Shift + ;`
- ZWNJ -> `Shift + Space`

The Windows-compatible XKB profile has different shifted Persian marks, and 2.1.1 mirrors those separately instead of mixing the two layouts.

Static mappings are still only a fallback. During practice, Keyflow learns the real tuple:

```text
KeyboardEvent.key + KeyboardEvent.code + Shift + AltGr
```

Learned mappings override the profile. Settings also provides a guided Persian calibration wizard.

## AI practice studio

Providers are model-discovery based; there is no stale model dropdown.

Supported adapters:

- OpenRouter free models / free router
- GroqCloud
- Google Gemini
- Mistral
- Cerebras Inference
- NVIDIA NIM / API Catalog
- Cloudflare Workers AI
- Custom OpenAI-compatible API, including local endpoints with no API key

Custom endpoints support configurable model/chat paths, auth header/prefix, extra headers, and an optional response-text path.

The Smart Pick logic prefers usable free/fast chat models and filters embedding, reranking, image, TTS, speech and moderation models. OpenRouter zero-cost pricing detection handles numeric or string zero values correctly.

### AI text quality pipeline

Generation is not accepted directly into the trainer.

1. Generate structured JSON.
2. Normalize Persian Unicode.
3. Check script/language purity.
4. Check length/repetition.
5. Check every character against the selected keyboard mapping.
6. Repair invalid output, up to three attempts.
7. Optional **deep language review** performs a second copy-edit pass for grammar, verb agreement, tense continuity, natural wording, meaning and story causality.
8. Re-run the complete keyboard/content validator before accepting the reviewed draft.

The deep review toggle is enabled by default.

## Practice features

Implemented, not placeholder cards:

- normal story/text practice;
- no-repeat shuffle bag with usage balancing;
- separate English/Persian goals and histories;
- weak-character + weak-transition adaptive drills;
- rhythm drills built from actual bigram timing;
- punctuation drill;
- numbers/symbols drill;
- live target-WPM delta;
- input-latency p95 while typing;
- physical next-key hint;
- passive keyboard self-learning;
- guided Persian layout calibration;
- weak-key physical keyboard heatmap;
- strict accuracy mode;
- focus mode;
- automatic pause while unfocused;
- adaptive difficulty that changes only one level at a time;
- per-session personal-best detection;
- **Retry mistakes** recovery drill generated from the just-finished session;
- keystroke replay with original timing;
- fatigue curve across session thirds;
- content cleaner/importer;
- local JSON analytics export;
- command palette (`Ctrl+K`).

## Analytics

The Progress screen tracks:

- net and raw WPM;
- recent and all-time speed;
- speed trend;
- accuracy and errors per 1,000 characters;
- consistency;
- correction rate;
- UI/event queue p95 latency;
- daily goal progress;
- streak;
- per-character error rate + latency;
- per-bigram error rate + latency;
- physical weak-key heatmap;
- English/Persian comparison;
- recent sessions and replay;
- a rule-based **Next useful session** coach that recommends accuracy, rhythm, transition, pace or difficulty work from real measurements.

## Run on EndeavourOS

```bash
sudo pacman -S --needed \
  base-devel webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf \
  nodejs-lts-jod npm rust cargo-tauri

npm install
npm run check
npm run tauri:dev
```

Build the one supported packaged artifact:

```bash
npm run tauri:build
```

## CI

`.github/workflows/linux.yml` builds in an `archlinux:latest` container and uploads only:

```text
*.AppImage
```

It runs the core tests and a build contract first. The contract guards the EndeavourOS renderer workaround, AppImage-only packaging, exact XKB mappings, Cuelume package import, IndexedDB recent-session index and the main performance/adaptive features.

## Validation available in this source tree

```bash
npm test
node scripts/build-contract.mjs
```

The source tests cover Persian normalization, XKB Standard and Windows-compat mappings, keyboard safety for all built-in texts, learned mapping precedence, content validation, session metrics and language-separated aggregation.

## Important files

```text
app/core/typing-engine.js       latency-critical typing engine
app/core/layouts.js             exact XKB profiles + self-learning
app/core/storage.js             IndexedDB v2 + recent-session index
app/core/stats.js               analytics/adaptive signals
app/core/shuffle-bag.js         no-repeat scheduler
app/core/content-validator.js   AI/import quality gate
app/ai/providers.js             provider/model discovery + Smart Pick
app/ai/generator.js             generate/repair/deep-review pipeline
app/audio/audio.js              non-blocking Cuelume feedback
app/ui/keyboard.js              next-key + physical weakness heatmap
src-tauri/src/lib.rs            WebKitGTK renderer safety + HTTP bridge
.github/workflows/linux.yml     EndeavourOS/Arch AppImage-only CI
```

## Secrets

API keys are never exported or written to localStorage. They remain in session storage for the running app session. Non-secret provider configuration is persisted locally.

## 2.1.1 CI reliability fix

GitHub Actions now uses Arch's Node 22 LTS (`nodejs-lts-jod`) instead of rolling Node Current, and it uses Arch's official `cargo-tauri` package for the desktop build. `@tauri-apps/cli` is deliberately not installed from npm, so the npm optional-native-binding failure cannot occur.

Build outputs are no longer stored with `actions/upload-artifact`. Push/manual builds upload the AppImage and `SHA256SUMS.txt` directly to the AASoft Serv00 upload hub using `SERV00_UPLOAD_TOKEN` and the existing uploader metadata fields.

## 2.1.8 CI packaging note

The AppImage is built on a native Ubuntu 22.04 GitHub runner rather than inside an
Arch Docker job. This is intentional: the shipped file is still an AppImage for
EndeavourOS/Arch, while the native VM avoids linuxdeploy/FUSE restrictions of a
job container and gives a more compatible glibc baseline. See `BUILD_FIX_2.1.8.md`.

## 2.3.1 audio note

On Linux, WebKitGTK's Web Audio output depends on GStreamer. Keyflow therefore enables Tauri AppImage `bundleMediaFramework` and the CI runner installs GStreamer Base/Good plus PulseAudio/ALSA sink plugins. The release audit refuses to publish an AppImage unless `appsrc`, `autoaudiosink`, conversion/resampling plugins, an audio sink, the plugin scanner, and the AppRun GStreamer hook are present.

Keyflow uses **Cuelume 0.2.4** as its typing feedback palette. Settings show `GStreamer ready` when the packaged runtime media stack is complete.

## Keyflow 2.5.0 audit

See [AUDIT_2.5.0.md](AUDIT_2.5.0.md) for the source-level bug analysis, reproducible regressions, and six new features: pace ghost, estimated finish, microbreaks, mistake microscope/drill, daily quests, and session comparison/error timeline. To run the new targeted tests independently:

```bash
node tests/audit-2.5.mjs
```
