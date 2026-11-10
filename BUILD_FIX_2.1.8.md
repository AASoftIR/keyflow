# Keyflow 2.1.8 build/runtime fix

The 2.1.7 build itself succeeded. CI failed only because Keyflow's own AppImage audit was too strict: it incorrectly treated `libwayland-egl.so.1` and `libwayland-cursor.so.0` as fatal even though Tauri 2.12's repaired linuxdeploy path may still bundle those support shims while correctly excluding the Mesa-breaking `libwayland-client.so.0`.

2.1.8 makes the audit precise: `libwayland-client`, EGL/GL/GBM/DRM driver ABI libraries remain fatal; `libwayland-egl` and `libwayland-cursor` are informational only. A fixture test now proves both cases.

For runtime resilience on the primary EndeavourOS target, AppImage launches also set `WEBKIT_DISABLE_COMPOSITING_MODE=1` in addition to the existing DMABUF workaround. Native/dev runs remain accelerated.
