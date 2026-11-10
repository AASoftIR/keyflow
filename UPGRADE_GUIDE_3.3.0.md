# Upgrading KeyFlow from 3.2.0 to 3.3.0

1. **Back up your records first:** use KeyFlow's Data Vault export and preserve your native wallet/key configuration. Do not delete `~/.local/share` or app data folders as part of the upgrade.
2. **Replace the repository source:** extract the archive, copy the contents of `keyflow/` into the repository root, including hidden `.github/` build workflows. Retain your existing personal files outside the repository.
3. **Check the project:** use Node.js 22, run `npm ci` where an internet connection and system dependencies are available, then `npm run check`.
4. **Preview:** `npm run dev` for the browser UI. The browser preview has no native persistent key storage; use the actual Tauri build to test KDE Wallet/Secret Service.
5. **Build AppImage:** run the existing GitHub Actions release workflow or `npm run tauri:build` in a Linux machine with Tauri/WebKitGTK/Rust prerequisites installed.
6. **Try the studio:** Practice → Warm-up / Repair / Flow / Code; Settings → Personal workspace → Accent / Surface / Motion; Ctrl+K or titlebar search to open actions.
7. **Performance fallback:** if GPU or WebKitGTK rendering is troublesome, choose Ultra latency + Quiet surface + no motion. These settings don't alter passage correctness, completion rules, or practice history.

## Compatibility

- `SETTINGS_SCHEMA=13`: new `visualStyle` and `motionStyle` values validate and fall back to safe defaults for older settings.
- Existing palettes, themes, Tauri secrets, session history, Library, AI provider configurations, and completion-only no-repeat scheduling remain in place.
- Narrow-window navigation now uses a bottom dock at widths up to 760px; this is intentional.

## Validation caveat

Only the JS/source contracts and isolated Chromium application smoke test have been verified in the release environment. Test a native production AppImage, API key storage, real AI generation, WebKitGTK rendering, and system audio on your machine before relying on them.
