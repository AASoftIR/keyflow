# Keyflow 2.1.7

## Fixed

- Fixed the EndeavourOS/Arch blank AppImage window with `Could not create default EGL display: EGL_BAD_PARAMETER` by moving packaging from Tauri 2.11 to the repaired Tauri 2.12 AppImage bundler.
- Upgraded the coherent Rust Tauri family to 2.12.0 (`tauri`, `tauri-runtime`, `tauri-runtime-wry`), macros/build/codegen to 2.7.0, utils to 2.10.0, JS API to 2.12.0 and native `cargo-tauri` CLI to 2.12.0.
- Added an extracted-AppImage ABI audit that forbids bundled Wayland/EGL/GL/GBM libraries known to conflict with rolling Mesa hosts.
- Added a guard against stale AppRun hooks that force `GDK_BACKEND=x11`.
- Kept the DMABUF WebKit fallback for driver-specific issues, but no longer relies on renderer environment flags to hide a packaging ABI problem.
- AppImage remains the only Linux package. Serv00 remains the release uploader.
