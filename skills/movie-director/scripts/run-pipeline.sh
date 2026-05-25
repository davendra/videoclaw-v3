#!/usr/bin/env bash
# run-pipeline.sh — Three-phase runner with approval gate.
# Invoked by interview.sh and auto.sh; can also be called standalone from a project.yaml.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
CLI_BIN="${VIDEOCLAW_ROOT}/dist/cli/vclaw.js"

if [ -z "$1" ]; then
  echo "Usage: $0 \"<intent prose>\" --scenes N --style X --color-grading Y --gb-character Name:ID ..."
  exit 1
fi

INTENT="$1"
shift
EXTRA_FLAGS=("$@")

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Phase 1 — write storyboard
echo -e "${CYAN}=== Phase 1: Preflight + Storyboard (no Seedance cost) ===${NC}"
phase1_json="$(mktemp)"
"$CLI_BIN" video create "$INTENT" \
  --production-mode director \
  "${EXTRA_FLAGS[@]}" \
  --execute > "$phase1_json"

STORYBOARD="$(node -e '
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(String(payload.review?.markdownPath ?? ""));
' "$phase1_json")"
if [ -z "$STORYBOARD" ]; then
  echo -e "${YELLOW}No storyboard found — check for errors above${NC}"
  rm -f "$phase1_json"
  exit 1
fi

PROJECT_DIR="$(node -e '
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(String(payload.workspace?.projectDir ?? ""));
' "$phase1_json")"
ESTIMATED_TOTAL="$(node -e '
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const total = payload.costEstimate?.totalUsd;
if (typeof total === "number") process.stdout.write(String(total.toFixed(2)));
' "$phase1_json" || true)"
echo ""
echo -e "${GREEN}✓${NC} Storyboard: $STORYBOARD"
open "$STORYBOARD" 2>/dev/null

echo ""
echo -e "${YELLOW}Review the storyboard. When ready:${NC}"
echo "  - [y] approve → fire Seedance (~\$${ESTIMATED_TOTAL:-?})"
echo "  - [n] iterate on intent prose (no Seedance cost)"
echo "  - [q] quit and approve later manually"
read -p "> " DECISION

case "$DECISION" in
  y|Y)
    echo ""
    echo -e "${CYAN}=== Phase 2: Rendering (Seedance) ===${NC}"
    phase2_json="$(mktemp)"
    VIDEOCLAW_APPROVE_STORYBOARD=1 "$CLI_BIN" video create "$INTENT" \
      --production-mode director \
      "${EXTRA_FLAGS[@]}" \
      --execute > "$phase2_json"

    # Phase 3 — re-mux
    echo ""
    echo -e "${CYAN}=== Phase 3: Re-mux narrated (if needed) ===${NC}"
    cd "$PROJECT_DIR"
    if ls videos/*_narrated.mp4 >/dev/null 2>&1; then
      ls videos/ | grep narrated | sort | \
        awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > /tmp/concat.txt
      ffmpeg -y -f concat -safe 0 -i /tmp/concat.txt -c copy final/narrated-fixed.mp4 2>&1 | tail -1
    fi

    FINAL=$(ls final/narrated-fixed.mp4 final/*_director_narrated.mp4 final/*_director.mp4 2>/dev/null | head -1)
    open "$FINAL" 2>/dev/null || echo "Final: $FINAL"

    echo ""
    echo -e "${GREEN}=== Movie complete ===${NC}"
    echo "Final: $FINAL"
    rm -f "$phase2_json"
    ;;
  q|Q)
    echo "Storyboard saved at $STORYBOARD."
    echo "Resume later with:"
    echo "  VIDEOCLAW_APPROVE_STORYBOARD=1 <original command>"
    ;;
  *)
    echo "Not approved. Edit the intent prose and re-run Phase 1."
    ;;
esac

rm -f "$phase1_json"
