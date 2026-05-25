#!/usr/bin/env bash
# auto.sh — Auto-mode movie creation from a single premise.
# Infers genre, fills defaults, runs to storyboard gate. User only confirms at approval.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
CLI_BIN="${VIDEOCLAW_ROOT}/dist/cli/vclaw.js"

if [ -z "$1" ]; then
  echo "Usage: $0 \"<premise one-liner>\""
  echo "Example: $0 \"An astronaut discovers an alien flower on Mars\""
  exit 1
fi

PREMISE="$1"
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

parse_json_field() {
  local file="$1"
  local expr="$2"
  node -e '
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const expr = process.argv[2];
const value = expr.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), payload);
if (value === undefined || value === null) process.exit(1);
process.stdout.write(String(value));
' "$file" "$expr"
}

echo -e "${CYAN}=== Movie Director — Auto Mode ===${NC}"
echo "Premise: $PREMISE"
echo ""

# Heuristic genre inference
GENRE="short-film"
case "$PREMISE" in
  *astronaut*|*space*|*Mars*|*spaceship*|*alien*|*planet*) GENRE="sci-fi" ;;
  *agent*|*hunt*|*chase*|*thriller*|*spy*|*assassin*) GENRE="action-thriller" ;;
  *bunny*|*fox*|*kitten*|*puppy*|*child*|*kid*) GENRE="storybook" ;;
  *samurai*|*knight*|*dragon*|*wizard*|*magic*) GENRE="fantasy" ;;
  *potter*|*painter*|*chef*|*dancer*|*day\ in\ the\ life*) GENRE="documentary" ;;
  *product*|*brand*|*ad*|*marketing*|*testimonial*) GENRE="ugc-ad" ;;
  *music*|*song*|*beat*|*neon*|*rain*|*mood*) GENRE="music-video" ;;
  *love*|*romance*|*meet-cute*|*bookshop*|*café*|*cafe*) GENRE="romance" ;;
  *horror*|*ghost*|*haunted*|*door*|*scary*) GENRE="horror" ;;
  *cowboy*|*sheriff*|*desert*|*stagecoach*|*saloon*) GENRE="western" ;;
esac

# Genre → defaults
case "$GENRE" in
  action-thriller) STYLE=villeneuve; GRADING=neon-noir; SCENES=14 ;;
  storybook)       STYLE=miyazaki;   GRADING=pastel-dream; SCENES=12 ;;
  documentary)     STYLE=nolan;      GRADING=desaturated;  SCENES=10 ;;
  ugc-ad)          STYLE=spielberg;  GRADING=golden-hour;  SCENES=10 ;;
  music-video)     STYLE=wong-kar-wai; GRADING=neon-noir;  SCENES=14 ;;
  romance)         STYLE=wes-anderson; GRADING=pastel-dream; SCENES=12 ;;
  horror)          STYLE=fincher;    GRADING=ice-cold;      SCENES=12 ;;
  sci-fi)          STYLE=villeneuve; GRADING=teal-orange;   SCENES=14 ;;
  fantasy)         STYLE=miyazaki;   GRADING=golden-hour;   SCENES=14 ;;
  western)         STYLE=tarantino;  GRADING=desaturated;   SCENES=12 ;;
  *)               STYLE=villeneuve; GRADING=teal-orange;   SCENES=14 ;;
esac

echo "Inferred genre: $GENRE"
echo "Style:          $STYLE + $GRADING"
echo "Scenes:         $SCENES"
echo "Platform:       youtube"
echo ""

read -p "Proceed with these defaults? [Y/n] " GO
if [[ "$GO" =~ ^[Nn] ]]; then
  echo "Aborted. Use interview.sh for manual control."
  exit 0
fi

echo ""
echo -e "${CYAN}--- Phase 1: Writing storyboard ---${NC}"
phase1_json="$(mktemp)"
phase2_json=""
node "$CLI_BIN" video create "$PREMISE" \
  --scenes "$SCENES" \
  --production-mode director \
  --style "$STYLE" \
  --color-grading "$GRADING" \
  --platform youtube \
  --execute > "$phase1_json"

STORYBOARD="$(parse_json_field "$phase1_json" 'review.markdownPath')" || {
  echo "Storyboard not found. Check errors above."
  rm -f "$phase1_json"
  exit 1
}
PROJECT_DIR="$(parse_json_field "$phase1_json" 'workspace.projectDir')" || PROJECT_DIR="$(dirname "$STORYBOARD")"
COST_TOTAL="$(parse_json_field "$phase1_json" 'costEstimate.totalUsd' || true)"

open "$STORYBOARD" 2>/dev/null || echo "Review: $STORYBOARD"
echo ""
read -p "Approve and render? (~\$${COST_TOTAL:-?}) [y/N] " APPROVE
if [[ ! "$APPROVE" =~ ^[Yy] ]]; then
  echo "Not approved. Storyboard saved — iterate on prose and re-run."
  rm -f "$phase1_json"
  exit 0
fi

echo ""
echo -e "${CYAN}--- Phase 2: Rendering ---${NC}"
phase2_json="$(mktemp)"
VIDEOCLAW_APPROVE_STORYBOARD=1 node "$CLI_BIN" video create "$PREMISE" \
  --scenes "$SCENES" \
  --production-mode director \
  --style "$STYLE" \
  --color-grading "$GRADING" \
  --platform youtube \
  --execute > "$phase2_json"

# Phase 3 mop-up
echo ""
echo -e "${CYAN}--- Phase 3: Re-muxing narrated (if needed) ---${NC}"
cd "$PROJECT_DIR"
if ls videos/*_narrated.mp4 >/dev/null 2>&1; then
  ls videos/ | grep narrated | sort | \
    awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > /tmp/concat.txt
  ffmpeg -y -f concat -safe 0 -i /tmp/concat.txt -c copy final/narrated-fixed.mp4 2>&1 | tail -2
fi

FINAL=$(ls final/narrated-fixed.mp4 final/*_director_narrated.mp4 final/*_director.mp4 2>/dev/null | head -1)
open "$FINAL" 2>/dev/null || echo "Final: $FINAL"

echo ""
echo -e "${GREEN}=== Movie complete ===${NC}"
echo "Final: $FINAL"

rm -f "$phase1_json"
if [ -n "$phase2_json" ]; then
  rm -f "$phase2_json"
fi
