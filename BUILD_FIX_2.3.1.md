# Keyflow 2.3.1 — EndeavourOS audio/GStreamer fix

The 2.3.0 AppImage could render correctly but WebKitGTK printed:

- `GStreamer element appsrc not found`
- `GStreamer element autoaudiosink not found`

That is the root cause of the silent typing coach. WebKitGTK implements Web Audio through GStreamer on Linux, so changing JavaScript synth code cannot repair an AppImage that omitted the media plugins.

## Fix

- `bundleMediaFramework` is now enabled for AppImage.
- CI installs and verifies GStreamer Base + Good + PulseAudio/ALSA plugins before packaging.
- The finished AppImage is rejected unless it contains `libgstapp.so`, `libgstautodetect.so`, audio conversion/resampling plugins, a real audio sink, `gst-plugin-scanner`, and the Tauri GStreamer AppRun hook.
- Native startup reinforces the AppImage `GST_PLUGIN_*` paths before WebKitGTK starts.
- Keyflow now uses Cuelume 0.2.4 directly for all typing feedback rather than maintaining a separate synthesizer.
- Backspace receives Cuelume's delete-key typing cue.
- Settings show whether the native AppImage media framework was detected and complete.

The Mesa/libwayland AppImage audit remains in place and still rejects host-coupled graphics libraries.
