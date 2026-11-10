# 2.1.5

- Fixed the actual repeated Rust build failure: a mixed Tauri dependency graph.
- Pinned the full Tauri 2.11.6-compatible Rust crate family instead of only the top-level crate.
- Added lockfile generation and exact resolved-version assertions in CI.
- Native compile preflight now uses `cargo check --locked`.
- Final AppImage build passes `--locked` to Cargo.
- EndeavourOS/Arch AppImage remains the only Linux package target.
- Serv00 remains the only CI artifact uploader.
