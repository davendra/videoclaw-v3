#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: bash skills/video-post/scripts/make-square.sh <input.mp4> <output.mp4>" >&2
  exit 1
fi

INPUT="$1"
OUTPUT="$2"

ffmpeg -y -i "$INPUT" \
  -vf "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080" \
  -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k \
  "$OUTPUT"
