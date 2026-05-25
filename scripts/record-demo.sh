#!/usr/bin/env bash
# Record the vclaw quickstart demo as an asciicast and render it to GIF.
#
# Prereqs (one-time):
#   brew install asciinema agg
#
# Output:
#   docs/assets/demo-quickstart.cast  (source asciicast — commit this)
#   docs/assets/demo-quickstart.gif   (rendered gif — commit this)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$ROOT/docs/assets"
CAST_FILE="$ASSETS_DIR/demo-quickstart.cast"
GIF_FILE="$ASSETS_DIR/demo-quickstart.gif"

mkdir -p "$ASSETS_DIR"

if ! command -v asciinema >/dev/null 2>&1; then
  echo "asciinema not found. Install: brew install asciinema" >&2
  exit 1
fi

if ! command -v agg >/dev/null 2>&1; then
  echo "agg not found. Install: brew install agg" >&2
  exit 1
fi

cd "$ROOT"

echo "▶ building CLI"
npm run build --silent

echo "▶ recording demo to $CAST_FILE"
rm -f "$CAST_FILE"
asciinema rec \
  --overwrite \
  --cols 100 \
  --rows 28 \
  --idle-time-limit 2 \
  --command "node scripts/demo-quickstart.mjs" \
  "$CAST_FILE"

echo "▶ rendering gif to $GIF_FILE"
rm -f "$GIF_FILE"
agg \
  --theme monokai \
  --font-size 16 \
  --line-height 1.3 \
  --speed 1.0 \
  "$CAST_FILE" "$GIF_FILE"

echo "▶ done"
ls -lh "$CAST_FILE" "$GIF_FILE"
