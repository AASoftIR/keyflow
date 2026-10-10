# Keyflow 2.1.5 — real Tauri dependency-graph fix

## Root cause

2.1.4 pinned only the top-level `tauri` and `tauri-build` crates. That was not enough.
Cargo uses caret semantics by default for transitive dependencies, so `tauri 2.11.1`
was allowed to resolve newer `tauri-runtime 2.12.0`, `tauri-runtime-wry 2.12.0`,
`tauri-macros 2.7.0`, `tauri-codegen 2.7.0`, and `tauri-utils 2.10.0`.
Those crates changed internal APIs and are not source-compatible with the 2.11 core.
The result was compiler errors *inside Tauri itself* (`app.rs`), not inside Keyflow.

## Fix

Keyflow now pins the complete known-compatible Tauri 2.11.6 release family:

- tauri 2.11.6
- tauri-runtime 2.11.3
- tauri-runtime-wry 2.11.4
- tauri-utils 2.9.3
- tauri-macros 2.6.3
- tauri-codegen 2.6.3
- tauri-build 2.6.3
- @tauri-apps/api 2.11.1 (same supported 2.11 JS API line)

`tauri-runtime-wry 2.11.4` constrains its backend to the compatible Wry 0.55.x and
Tao 0.35.x API lines.

CI now generates `src-tauri/Cargo.lock` once after those exact pins, verifies the
resolved versions with `cargo tree`, runs `cargo check --locked`, then builds with
`cargo tauri build -- --locked`. A future registry release can no longer silently
mix Tauri 2.11 with runtime 2.12.
