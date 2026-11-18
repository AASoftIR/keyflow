#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT="$ROOT_DIR/scripts/appimage-runtime-audit.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

make_media_fixture() {
  local root="$1"
  mkdir -p "$root/usr/lib/gstreamer-1.0" "$root/usr/lib/gstreamer1.0/gstreamer-1.0" "$root/apprun-hooks"
  touch "$root/usr/lib/libwayland-egl.so.1" "$root/usr/lib/libwayland-cursor.so.0"
  for f in libgstapp.so libgstautodetect.so libgstaudioconvert.so libgstaudioresample.so libgstvolume.so libgstpulseaudio.so; do
    touch "$root/usr/lib/gstreamer-1.0/$f"
  done
  printf '#!/bin/sh\n' > "$root/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
  chmod +x "$root/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
  cat > "$root/apprun-hooks/linuxdeploy-plugin-gstreamer.sh" <<'HOOK'
#!/bin/sh
export GST_PLUGIN_SYSTEM_PATH_1_0="$APPDIR/usr/lib/gstreamer-1.0"
export GST_PLUGIN_PATH_1_0="$APPDIR/usr/lib/gstreamer-1.0"
export GST_PLUGIN_SCANNER_1_0="$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
HOOK
}

make_media_fixture "$TMP/good"
"$AUDIT" "$TMP/good" >/dev/null
echo '✓ audit accepts media-complete Tauri AppImage'

cp -a "$TMP/good" "$TMP/bad-graphics"
touch "$TMP/bad-graphics/usr/lib/libwayland-client.so.0"
if "$AUDIT" "$TMP/bad-graphics" >/dev/null 2>&1; then
  echo 'ERROR: audit accepted bundled libwayland-client.so.0' >&2
  exit 1
fi
echo '✓ audit rejects bundled libwayland-client.so.0'

cp -a "$TMP/good" "$TMP/bad-media"
rm "$TMP/bad-media/usr/lib/gstreamer-1.0/libgstapp.so"
if "$AUDIT" "$TMP/bad-media" >/dev/null 2>&1; then
  echo 'ERROR: audit accepted an AppImage without appsrc' >&2
  exit 1
fi
echo '✓ audit rejects AppImage missing appsrc/WebAudio media plugin'
