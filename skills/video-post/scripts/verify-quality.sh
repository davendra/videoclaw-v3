#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash skills/video-post/scripts/verify-quality.sh <video.mp4|project-dir> [output-dir]" >&2
  exit 1
fi

INPUT="$1"
OUTPUT_DIR="${2:-.}"

if [[ -d "$INPUT" ]]; then
  INPUT_FILE="$(find "$INPUT/final" -maxdepth 1 -type f -name '*.mp4' | sort | head -n 1)"
  if [[ -z "${INPUT_FILE:-}" ]]; then
    echo "no final mp4 found under $INPUT/final" >&2
    exit 1
  fi
else
  INPUT_FILE="$INPUT"
fi

mkdir -p "$OUTPUT_DIR"

REPORT_JSON="$(ffprobe -v error -show_streams -show_format -of json "$INPUT_FILE")"
export REPORT_JSON

python3 - "$INPUT_FILE" <<'PY'
import json
import os
import sys

report = json.loads(os.environ["REPORT_JSON"])
video = next((stream for stream in report.get("streams", []) if stream.get("codec_type") == "video"), {})
audio = next((stream for stream in report.get("streams", []) if stream.get("codec_type") == "audio"), None)
fmt = report.get("format", {})

print("POST CHECK")
print("==========")
print(f"source={sys.argv[1]}")
print(f"duration={fmt.get('duration', 'unknown')}")
print(f"size={fmt.get('size', 'unknown')}")
print(f"video_codec={video.get('codec_name', 'unknown')}")
print(f"resolution={video.get('width', '?')}x{video.get('height', '?')}")
print(f"frame_rate={video.get('r_frame_rate', 'unknown')}")
print(f"audio_present={'yes' if audio else 'no'}")
if audio:
    print(f"audio_codec={audio.get('codec_name', 'unknown')}")
PY

DURATION="$(python3 - <<'PY'
import json
import os
report = json.loads(os.environ["REPORT_JSON"])
print(report.get("format", {}).get("duration", "0"))
PY
)"

MIDPOINT="$(python3 - "$DURATION" <<'PY'
import sys
duration = float(sys.argv[1]) if sys.argv[1] else 0.0
print(max(duration / 2.0, 0.0))
PY
)"

ffmpeg -y -ss "$MIDPOINT" -i "$INPUT_FILE" -frames:v 1 -update 1 "$OUTPUT_DIR/post-check-frame.jpg" >/dev/null 2>&1
echo "frame=$OUTPUT_DIR/post-check-frame.jpg"
