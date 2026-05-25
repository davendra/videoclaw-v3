#!/usr/bin/env bash
# iterate.sh — cheap storyboard regeneration after prose edit.
# Use when the storyboard read poorly but you DON'T want to burn Seedance.
# Rewrites the intent prose, regenerates storyboard.md, never fires Seedance.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
CLI_BIN="${VIDEOCLAW_ROOT}/dist/cli/vclaw.js"

if [ -z "$1" ]; then
  echo "Usage: $0 \"<new intent prose>\" [--scenes N] [--style X] [--gb-character Name:ID] ..."
  echo ""
  echo "Regenerates storyboard.md for review WITHOUT burning Seedance credits."
  echo "Use this to iterate on prose cheaply until the storyboard reads right."
  exit 1
fi

INTENT="$1"
shift
EXTRA_FLAGS=("$@")

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Iterate — regenerate storyboard (no Seedance) ===${NC}"
echo ""
echo "This run will:"
echo "  1. Re-run script LLM (~\$0.01 Gemini)"
echo "  2. Re-run batched decomposition (~\$0.02 Gemini)"
echo "  3. Write new storyboard.md"
echo "  4. STOP — no Seedance, no render"
echo ""
echo "If anything is still off, edit the prose and re-run this script again."
echo ""

phase_json="$(mktemp)"
"$CLI_BIN" video create "$INTENT" \
  --production-mode director \
  "${EXTRA_FLAGS[@]}" \
  --execute > "$phase_json"

STORYBOARD="$(node -e '
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(String(payload.review?.markdownPath ?? ""));
' "$phase_json")"
if [ -z "$STORYBOARD" ]; then
  echo "No storyboard found."
  rm -f "$phase_json"
  exit 1
fi

echo ""
echo -e "${GREEN}✓${NC} Storyboard: $STORYBOARD"
echo ""
echo "Review. If good, re-run with VIDEOCLAW_APPROVE_STORYBOARD=1 to render."
echo "If still off, edit prose and re-run this script."

open "$STORYBOARD" 2>/dev/null
rm -f "$phase_json"
