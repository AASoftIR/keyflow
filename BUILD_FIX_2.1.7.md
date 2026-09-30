# Keyflow 2.1.7 — EndeavourOS blank AppImage root-cause fix

The 2.1.6 executable compiled and packaged correctly, but its AppImage was made by the Tauri 2.11 bundler. That bundler could copy an old `libwayland-client`/graphics ABI stack from the Ubuntu build host into the AppImage. On a rolling EndeavourOS/Mesa host, WebKitGTK then loaded the host Mesa/EGL driver against those bundled older libraries. `eglGetDisplay(EGL_DEFAULT_DISPLAY)` failed with `EGL_BAD_PARAMETER`, the WebKit web process aborted, and the GTK shell remained as a blank dark window.

`WEBKIT_DISABLE_DMABUF_RENDERER` cannot repair that ABI collision because the failure occurs in the WebKit child process while initializing EGL with the wrong AppImage libraries.

2.1.7 moves the complete desktop stack and native CLI to Tauri 2.12.0. Tauri 2.12 contains the upstream linuxdeploy/GTK AppImage repair merged in tauri-apps/tauri#16062. It also stops the old GTK hook from unconditionally forcing `GDK_BACKEND=x11`.

The CI now extracts every generated AppImage and rejects it if it contains `libwayland-client`, `libwayland-egl`, `libwayland-cursor`, `libEGL`, `libGL`, `libGLX`, or `libgbm`, or if a stale AppRun hook still forces X11. This turns the exact runtime crash class into a build-time failure instead of shipping another blank AppImage.

Keyflow remains AppImage-only and continues uploading releases to Serv00.
