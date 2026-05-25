#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: bash skills/video-post/scripts/thumbnail.sh <input.mp4> <output.jpg> [text]" >&2
  exit 1
fi

INPUT="$1"
OUTPUT="$2"
TEXT="${3-}"

DURATION="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$INPUT")"
MIDPOINT="$(python3 - "$DURATION" <<'PY'
import sys
duration = float(sys.argv[1]) if sys.argv[1] else 0.0
print(max(duration / 2.0, 0.0))
PY
)"

if [[ -z "$TEXT" ]]; then
  ffmpeg -y -ss "$MIDPOINT" -i "$INPUT" -frames:v 1 -update 1 "$OUTPUT"
else
  if ffmpeg -hide_banner -filters 2>/dev/null | grep -q '\bdrawtext\b'; then
    SAFE_TEXT="${TEXT//:/\\:}"
    ffmpeg -y -ss "$MIDPOINT" -i "$INPUT" \
      -vf "drawbox=x=0:y=ih-180:w=iw:h=180:color=black@0.45:t=fill,drawtext=text='${SAFE_TEXT}':x=60:y=h-120:fontsize=56:fontcolor=white" \
      -frames:v 1 -update 1 \
      "$OUTPUT"
  else
    ffmpeg -y -ss "$MIDPOINT" -i "$INPUT" -frames:v 1 -update 1 "$OUTPUT"
    echo "drawtext filter unavailable; exported frame without overlay" >&2
  fi
fi
