#!/usr/bin/env bash
set -euo pipefail

echo '=== Keyflow / EndeavourOS diagnostics ==='
if [[ -r /etc/os-release ]]; then
  grep -E '^(NAME|ID|ID_LIKE|VERSION)=' /etc/os-release || true
fi
printf 'desktop=%s\n' "${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-unknown}}"
printf 'session=%s\n' "${XDG_SESSION_TYPE:-unknown}"
printf 'wayland=%s\n' "${WAYLAND_DISPLAY:-none}"
printf 'x11=%s\n' "${DISPLAY:-none}"

echo '--- GPU ---'
if command -v lspci >/dev/null 2>&1; then
  lspci -nnk | grep -EA3 'VGA|3D|Display' || true
else
  echo 'lspci is not installed (package: pciutils)'
fi

echo '--- WebKitGTK ---'
pacman -Q webkit2gtk-4.1 2>/dev/null || echo 'webkit2gtk-4.1 is not installed'

echo '--- Keyflow startup log ---'
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/keyflow/startup.log"
if [[ -r "$LOG" ]]; then cat "$LOG"; else echo "No startup log yet: $LOG"; fi

echo '--- manual renderer fallbacks ---'
echo 'KEYFLOW_RENDERER=normal   ./Keyflow.AppImage'
echo 'KEYFLOW_RENDERER=software ./Keyflow.AppImage'
echo 'KEYFLOW_RENDERER=x11-safe ./Keyflow.AppImage'
