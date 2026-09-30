# Keyflow 2.1.6 — AppImage packaging fix

The 2.1.5 log proves the application itself compiled successfully:

- Vite production build completed.
- The pinned Tauri 2.11 dependency family compiled.
- Rust finished the optimized release profile.
- The native `keyflow-next` executable was produced.

The only failure happened afterward, when Tauri invoked `linuxdeploy` to turn the
working binary into an AppImage.

## Root cause

2.1.5 deliberately ran the whole job inside `container: archlinux:latest`.
Installing `fuse2` in that container only installs the userspace library; it does
not give the job container the host kernel's `/dev/fuse` device or the mount/
SYS_ADMIN capabilities AppImage/linuxdeploy tooling can require. That makes the
last packaging phase fragile even though Rust compilation is completely healthy.

Keyflow targets EndeavourOS, but an AppImage does **not** need to be packaged in
an Arch container. In fact, building it on an older compatible baseline is better
for glibc compatibility. The workflow now uses the native GitHub-hosted
`ubuntu-22.04` VM only as the packaging baseline while still emitting exactly one
AppImage for EndeavourOS/Arch users.

## Changes

- Removed the job-level Docker/Arch container.
- Uses a native `ubuntu-22.04` GitHub runner.
- Installs WebKitGTK 4.1, GTK3, Ayatana AppIndicator, librsvg, patchelf, xdg-utils
  and libfuse2 on the host VM.
- Sets `APPIMAGE_EXTRACT_AND_RUN=1` for AppImage helper tooling.
- Keeps the npm Tauri CLI removed; installs `tauri-cli 2.11.5` through Cargo.
- Keeps the fully pinned/verified Tauri 2.11 Rust graph from 2.1.5.
- Keeps AppImage as the only package format; no DEB/RPM.
- Extracts the finished AppImage in CI and verifies `AppRun` and `usr/bin` before
  uploading it.
- Keeps the existing Serv00 uploader and SHA-256 file.
- Adds a regression contract that fails if `container:` is reintroduced.
