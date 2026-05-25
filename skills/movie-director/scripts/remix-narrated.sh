#!/usr/bin/env bash
# remix-narrated.sh — fix the "moov atom not found" on *_director_narrated.mp4.
# Re-muxes the per-clip narrated files into a clean single mp4.

set -e

PROJECT_DIR="${1:-}"
if [ -z "$PROJECT_DIR" ]; then
  # Try latest project
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
  PROJECT_DIR=$(ls -td "$VIDEOCLAW_ROOT"/projects/*/ 2>/dev/null | head -1)
  PROJECT_DIR="${PROJECT_DIR%/}"
  if [ -z "$PROJECT_DIR" ]; then
    echo "Usage: $0 <project_dir>"
    echo "  or cd \"$VIDEOCLAW_ROOT/projects\" && $0 \$(ls -td */ | head -1 | tr -d /)"
    exit 1
  fi
  echo "Using latest project: $PROJECT_DIR"
fi

if [ ! -d "$PROJECT_DIR/videos" ]; then
  echo "No videos/ in $PROJECT_DIR"
  exit 1
fi

cd "$PROJECT_DIR"

# Check we have narrated clips
NARRATED_COUNT=$(ls videos/ 2>/dev/null | grep -c narrated || echo 0)
if [ "$NARRATED_COUNT" -eq 0 ]; then
  echo "No narrated clips in videos/ — narration was skipped or failed"
  exit 1
fi

echo "Found $NARRATED_COUNT narrated clip(s). Re-muxing..."

# Build concat file
CONCAT=$(mktemp)
ls videos/ | grep narrated | sort | \
  awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > "$CONCAT"

# Re-mux
OUTPUT="final/narrated-fixed.mp4"
ffmpeg -y -f concat -safe 0 -i "$CONCAT" -c copy "$OUTPUT" 2>&1 | tail -2

# Verify
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT" 2>/dev/null)
if [ -n "$DURATION" ]; then
  MIN=$(echo "scale=0; $DURATION / 60" | bc)
  SEC=$(echo "scale=0; $DURATION % 60" | bc)
  printf "✓ Fixed: %s (%02d:%02d)\n" "$OUTPUT" "$MIN" "$SEC"
  open "$OUTPUT" 2>/dev/null
else
  echo "✗ Re-mux failed"
  exit 1
fi

rm -f "$CONCAT"
