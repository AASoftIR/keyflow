# Keyflow 2.3.1

Audio reliability release for EndeavourOS AppImage.

The previous build's silent sound was not caused by volume or the key handler. WebKitGTK reported missing GStreamer `appsrc` and `autoaudiosink` elements. Keyflow now bundles the GStreamer media framework required by Web Audio and validates it inside the finished AppImage before Serv00 upload.

Cuelume 0.2.4 is now the primary and only typing-sound palette. Correct printable keys use `type`, Space uses the context-aware space variant, Backspace uses the delete variant, mistakes use strong `error`, and completion uses strong `success`. Mechanical, Soft, Minimal, and Playful profiles map to Cuelume themes.

Settings now expose AppImage/GStreamer readiness alongside the Cuelume audio state.
