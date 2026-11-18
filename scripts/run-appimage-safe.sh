#!/usr/bin/env bash
set -euo pipefail
APPIMAGE_PATH="${1:-}"
if [[ -z "$APPIMAGE_PATH" || ! -f "$APPIMAGE_PATH" ]]; then
  echo "Usage: $0 /path/to/Keyflow.AppImage" >&2
  exit 2
fi
chmod +x "$APPIMAGE_PATH"
export KEYFLOW_RENDERER="${KEYFLOW_RENDERER:-software}"
exec "$APPIMAGE_PATH"
