# Keyflow 2.1.4 build fix

## Root cause

Tauri's CLI rejects a desktop build when the JavaScript API and Rust `tauri` crate are on different major/minor release lines.

2.1.3 used:

- `@tauri-apps/api = 2.11.1`
- `tauri = "2"`

The broad Rust semver range resolved to `tauri 2.12.0`, while the current JavaScript API was still `2.11.1`, so `cargo tauri build` aborted before compilation.

## Fix

2.1.4 exact-pins the native Tauri side:

```toml
tauri = { version = "=2.11.1", features = [] }
tauri-build = { version = "=2.6.1", features = [] }
```

and keeps:

```json
"@tauri-apps/api": "2.11.1"
```

A new `scripts/tauri-version-contract.mjs` fails immediately if the Rust and JavaScript Tauri major/minor versions diverge again. CI also checks the actually resolved Rust crate with `cargo tree` before packaging.

The project remains EndeavourOS/Arch-first, AppImage-only, and uses the AASoft Serv00 uploader rather than GitHub artifacts.
