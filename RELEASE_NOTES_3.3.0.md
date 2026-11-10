# KeyFlow Next 3.3.0 — Studio Design System

## Scope

This is an actual UI implementation on the **3.2.0 working source**, not a static mockup and not a rewrite. It preserves the typing engine, native Tauri backend, AI providers (including OpenRouter and Dahl), saved sessions, anti-repeat/completion history, Persian shaping, and the existing GitHub Actions/AppImage pipeline. There are **no new runtime dependencies**.

## Design references and application

- **60fps.design / Motionin.design:** meaningful state changes and restrained micro-interactions. Motion has explicit `None`, `Subtle`, and `Expressive` controls. The passage itself, shaped Persian glyphs, and fixed caret overlay never receive decorative transforms or animations.
- **Mobbin / Landdding:** complete screen states, predictable hierarchy, clear navigation, and a purposeful, immediately usable first screen rather than effects-only marketing visuals.
- **beUI:** deliberate control affordances, contrasting focus/selected states, consistent small controls and compositional rhythm. All components here are **original vanilla JavaScript/CSS**, not imported React components.
- **Kubai Icons:** purposeful icon feedback. Navigation uses new original inline SVG strokes rather than copied source icons or a new dependency.
- **ThreeUI / cinematic dark design:** layered depth used selectively in non-typing panels, without WebGL, heavy canvases, parallax, or expensive shaders.

These references informed the design only; third-party UI/source assets were not bundled.

## Shipped changes

1. **Studio shell:** redesigned dark desktop rail, top command launcher, active route affordances, original thin-stroke vector navigation, and a bottom tab dock below 760px.
2. **Four functional practice routines:** Warm-up (quick fresh text), Repair (weak-key mode), Flow (Zen + longer session), and Code (Python snippets). Buttons actually start practice, not placeholder routes.
3. **Responsive typing-first layout:** at narrow widths, essential controls, next character, physical key, mistake panel, and actual passage remain reachable immediately; diagnostics and uncommon controls expand only when requested. The compact dock does not overlap the content.
4. **Practice progress without layout instability:** session progress indicator reuses the engine's existing progress event and updates only a percentage and a scale transform on a dedicated progress track. No extra polling loop or per-letter passage reflow.
5. **Appearance system:** three visual treatments (Quiet / Depth / Glass), five existing palette accents shown as live clickable swatches, and explicit motion preference. Saved in the existing settings store and migrated safely.
6. **Responsive panels:** unified elevations, borders, typography hierarchy, status surfaces, empty/loading states, and clearer AI/Library/Lab/Progress presentation.
7. **Accessible command palette / modal:** the command launcher opens the existing Ctrl+K palette, modal focus is moved inside and restored on close, Escape dismisses, and Tab navigation stays within the dialog. Route navigation uses `aria-current`.
8. **AI generation journey:** the existing bounded AI engine now gets an explicit four-stage visual progression (Connect, Generate, Validate, Use passage), with failed states and the existing credential-safe trace; provider logic and credentials are not changed by this design release.
9. **Reduced motion and low-power respect:** animation disabled by performance `ultra`, explicit reduce-motion or OS `prefers-reduced-motion`. Glass blur and rich effects never run on typing panels and are suppressed for low-power modes.
10. **Smaller supported Tauri window:** minWidth 480px / minHeight 540px to enable side-by-side desktop workflows.

## Key implementation files

- `app/studio.css` — new, dependency-free responsive design-system layer.
- `app/ui/studio.js` — pure helpers for presentation profiles, practice presets and progress.
- `app/index.html` — semantic shell/navigation and command entry point.
- `app/main.js` — wiring of settings, routines, focus control, AI journey and navigation.
- `app/core/storage.js` — settings schema 13 and backward-compatible preference validation.
- `tests/regression-3.3.mjs` — new design and behavior contracts.
- `tests/run-studio-browser.py` — real Chromium UI regression test of the application modules; includes Persian viewport changes and wrong-key geometry.

## Tested

- `npm run check`: JavaScript, module, Rust-source, Tauri version, and AppImage audit *source* checks.
- `python tests/run-studio-browser.py`: Chromium smoke test with actual application modules including all routes, palette preferences, working practice routines, accessible dialog, Persian/English incorrect-letter feedback, and 480–940px resizing.
- Existing dedicated responsive/Persian tests also retained in the repository.

## Explicit limitations

The Chromium harness substitutes browser-local state and stubs native Tauri/audio APIs; it does **not** prove native credential handling or audio effects. A complete compiled AppImage, actual KDE Wallet, provider-account AI generation, and the production WebKitGTK runtime are **not** verified by these source/browser checks. No new benchmarks or universal performance claims are implied by the design improvements.

## Privacy and upgrade

Preferences persist locally using the existing settings store. The Studio feature does not transmit analytics or load design assets from remote servers. The existing native credential path remains separate; keys are not part of the new settings. See `UPGRADE_GUIDE_3.3.0.md`.
