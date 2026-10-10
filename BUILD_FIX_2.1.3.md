# Keyflow 2.1.3 — Rust lifetime/build fix

## Root cause

The 2.1.2 frontend built successfully, but native compilation failed with Rust `E0716` in GPU vendor detection.

The failing expression was:

```rust
value.trim().to_ascii_lowercase().as_str()
```

`to_ascii_lowercase()` creates a temporary `String`; `as_str()` borrowed that temporary and the match arm could return that borrowed slice as `other`, so the borrow escaped the statement where the temporary was destroyed.

## Fix

The normalized vendor ID is now stored in an owned `String` first. Known PCI vendor IDs are converted to owned labels and unknown IDs reuse the owned normalized value. No borrowed slice outlives a temporary.

## CI hardening

- `npm run check` now includes a Rust source contract guard for temporary-string borrow patterns.
- CI runs `cargo check --manifest-path src-tauri/Cargo.toml` before full AppImage packaging, so native compile errors fail in a smaller/faster stage.
- AppImage remains the only bundle target.
- Builds are still uploaded only through the AASoft Serv00 uploader; GitHub artifact storage is not used.
