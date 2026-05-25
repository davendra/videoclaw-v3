#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: bash skills/video-post/scripts/make-loop.sh <input.mp4> <output.mp4>" >&2
  exit 1
fi

INPUT="$1"
OUTPUT="$2"

if ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$INPUT" >/dev/null 2>&1; then
  ffmpeg -y -i "$INPUT" \
    -filter_complex "[0:v]split[vf][vr];[vr]reverse[rev];[vf][rev]concat=n=2:v=1:a=0[vout];[0:a]asplit[af][ar];[ar]areverse[arev];[af][arev]concat=n=2:v=0:a=1[aout]" \
    -map "[vout]" -map "[aout]" \
    -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k \
    "$OUTPUT"
else
  ffmpeg -y -i "$INPUT" \
    -filter_complex "[0:v]split[vf][vr];[vr]reverse[rev];[vf][rev]concat=n=2:v=1:a=0[vout]" \
    -map "[vout]" \
    -c:v libx264 -preset medium -crf 18 \
    "$OUTPUT"
fi
