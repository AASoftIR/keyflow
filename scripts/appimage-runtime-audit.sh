#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-}"
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "Usage: $0 /path/to/extracted/squashfs-root" >&2
  exit 2
fi

fail=0
search_roots=()
[[ -d "$ROOT/usr/lib" ]] && search_roots+=("$ROOT/usr/lib")
[[ -d "$ROOT/usr/lib64" ]] && search_roots+=("$ROOT/usr/lib64")

# Never shadow the rolling host's graphics/Mesa ABI.
fatal_patterns=(
  'libwayland-client.so*'
  'libEGL.so*'
  'libGL.so*'
  'libGLX.so*'
  'libGLdispatch.so*'
  'libOpenGL.so*'
  'libgbm.so*'
  'libdrm.so*'
)

if (( ${#search_roots[@]} )); then
  for pattern in "${fatal_patterns[@]}"; do
    while IFS= read -r -d '' f; do
      echo "ERROR: AppImage shadows host graphics ABI library: ${f#$ROOT/}" >&2
      fail=1
    done < <(find "${search_roots[@]}" \( -type f -o -type l \) -name "$pattern" -print0)
  done
  for pattern in 'libwayland-egl.so*' 'libwayland-cursor.so*'; do
    while IFS= read -r -d '' f; do
      echo "INFO: allowed Wayland support library: ${f#$ROOT/}"
    done < <(find "${search_roots[@]}" \( -type f -o -type l \) -name "$pattern" -print0)
  done
fi

if [[ -d "$ROOT/apprun-hooks" ]] && grep -R -n -E '^[[:space:]]*export[[:space:]]+GDK_BACKEND=x11([[:space:]]|$)' "$ROOT/apprun-hooks"; then
  echo 'ERROR: stale AppImage GTK hook still forces GDK_BACKEND=x11.' >&2
  fail=1
fi

# Keyflow has audible typing feedback. WebKitGTK implements Web Audio through
# GStreamer, so the AppImage is invalid unless the media framework contains the
# exact Base/Good plugins seen missing on the user's EndeavourOS machine.
GST="$ROOT/usr/lib/gstreamer-1.0"
SCANNER="$ROOT/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
HOOK="$ROOT/apprun-hooks/linuxdeploy-plugin-gstreamer.sh"

required_plugins=(
  libgstapp.so
  libgstautodetect.so
  libgstaudioconvert.so
  libgstaudioresample.so
  libgstvolume.so
)

if [[ ! -d "$GST" ]]; then
  echo 'ERROR: GStreamer plugin directory is missing; WebKitGTK WebAudio will be silent.' >&2
  fail=1
else
  for plugin in "${required_plugins[@]}"; do
    if [[ ! -f "$GST/$plugin" ]]; then
      echo "ERROR: required GStreamer plugin is missing: usr/lib/gstreamer-1.0/$plugin" >&2
      fail=1
    fi
  done
  if [[ ! -f "$GST/libgstpulseaudio.so" && ! -f "$GST/libgstalsa.so" ]]; then
    echo 'ERROR: neither PulseAudio nor ALSA GStreamer sink plugin is bundled.' >&2
    fail=1
  fi
fi

if [[ ! -x "$SCANNER" ]]; then
  echo 'ERROR: bundled gst-plugin-scanner is missing/not executable.' >&2
  fail=1
fi
if [[ ! -f "$HOOK" ]]; then
  echo 'ERROR: Tauri GStreamer AppRun hook is missing.' >&2
  fail=1
else
  grep -q 'GST_PLUGIN_SYSTEM_PATH_1_0' "$HOOK" || { echo 'ERROR: GStreamer hook does not set GST_PLUGIN_SYSTEM_PATH_1_0.' >&2; fail=1; }
  grep -q 'GST_PLUGIN_SCANNER_1_0' "$HOOK" || { echo 'ERROR: GStreamer hook does not set GST_PLUGIN_SCANNER_1_0.' >&2; fail=1; }
fi

if (( fail )); then
  echo 'AppImage runtime audit FAILED.' >&2
  exit 1
fi

echo '✓ AppImage runtime audit: Mesa ABI safe + bundled GStreamer WebAudio stack (appsrc, autoaudiosink, converters, sink, scanner)'
