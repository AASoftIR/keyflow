# Keyflow 2.1.2 — frontend module-link fix

## Failure fixed

Vite/Rollup failed before the Rust/Tauri compile because `app/ui/keyboard.js` imported `KEY_ROWS`, while `app/core/layouts.js` had renamed the canonical export to `PHYSICAL_ROWS`.

The UI now imports `PHYSICAL_ROWS` directly. `layouts.js` also exports `KEY_ROWS` as a compatibility alias so an older module cannot recreate the same failure accidentally.

## Regression prevention

`npm run check` now runs `scripts/module-contract.mjs` before the normal build-contract checks. It:

- syntax-checks every JavaScript file under `app/` with the exact Node runtime;
- resolves every relative ES-module import;
- verifies every named/default local import actually exists in the target module;
- fails CI before Vite/Tauri when a module is renamed without updating its consumers.

This specifically catches the class of error that produced:

`"KEY_ROWS" is not exported by "app/core/layouts.js"`

## Linux packaging

No packaging policy changed: EndeavourOS/Arch remains the target, AppImage is the only bundle, and CI uploads the AppImage plus SHA256SUMS.txt to the existing Serv00 uploader.
