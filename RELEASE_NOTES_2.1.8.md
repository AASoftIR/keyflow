# Keyflow 2.1.8

- Fixes the false-positive AppImage runtime audit that blocked a successfully built Tauri 2.12 image.
- Allows Tauri 2.12 `libwayland-egl` and `libwayland-cursor` support shims while still rejecting the confirmed Mesa-breaking `libwayland-client`.
- Adds a regression fixture for the audit itself.
- EndeavourOS AppImage launches now use WebKitGTK software compositing as a reliability fallback; native/dev runs keep acceleration.
- AppImage-only output and the Serv00 uploader are unchanged.
