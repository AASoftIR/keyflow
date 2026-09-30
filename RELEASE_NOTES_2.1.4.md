# Keyflow Next 2.1.4

Build reliability release for EndeavourOS / Arch Linux.

- Fixed Tauri JS/Rust version mismatch (`tauri 2.12.0` vs `@tauri-apps/api 2.11.1`).
- Exact-pinned Rust `tauri` to 2.11.1.
- Exact-pinned `tauri-build` to 2.6.1.
- Added a source-level Tauri version contract test.
- Added a resolved-version `cargo tree` gate before AppImage packaging.
- Kept AppImage-only packaging and the existing Serv00 upload workflow.
