#!/usr/bin/env bash
# interview.sh — interactive step-by-step movie creation.
# Asks the user structured questions, assembles a project.yaml, then runs the pipeline.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
CLI_BIN="${VIDEOCLAW_ROOT}/dist/cli/vclaw.js"
SKILL_ROOT="$VIDEOCLAW_ROOT/skills/movie-director"
STATE_DIR="${STATE_DIR:-.omc/movie-director}"
mkdir -p "$STATE_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Movie Director — Interview Mode ===${NC}"
echo ""
echo "I'll ask 10 questions, assemble your storyboard, and render after your approval."
echo "Each question has a [default] — press Enter to accept."
echo ""

# ---------- Resume prior session? ----------
LATEST_SESSION=$(ls -t "$STATE_DIR"/session-*.yaml 2>/dev/null | head -1)
if [ -n "$LATEST_SESSION" ]; then
  echo "Found prior session: $LATEST_SESSION"
  read -p "Resume? [y/N] " RESUME
  if [[ "$RESUME" =~ ^[Yy] ]]; then
    # Resume logic (Layer 3 — not yet implemented)
    echo "(Resume not yet supported — starting fresh)"
  fi
fi

SESSION_ID=$(date +%Y%m%d-%H%M%S)
PROJECT_YAML="$STATE_DIR/session-$SESSION_ID.yaml"
AUTO_CREATE_JSON="$(mktemp)"
printf '[]\n' > "$AUTO_CREATE_JSON"

append_auto_create_seed() {
  local json_path="$1"
  local name="$2"
  local description="$3"
  local style="$4"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const current = JSON.parse(fs.readFileSync(file, "utf8"));
current.push({
  name: process.argv[2],
  description: process.argv[3],
  style: process.argv[4],
});
fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
' "$json_path" "$name" "$description" "$style"
}

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

# Q1 — Premise
echo -e "${CYAN}--- Q1 / 10: Premise ---${NC}"
echo "One sentence: what's the movie about?"
read -p "> " PREMISE
if [ -z "$PREMISE" ]; then echo "Premise required. Exiting."; exit 1; fi

# Q2 — Genre
echo ""
echo -e "${CYAN}--- Q2 / 10: Genre ---${NC}"
echo "  1) action-thriller  (fast escape, clash, resolution)"
echo "  2) storybook         (warm, gentle, children)"
echo "  3) documentary       (day-in-the-life, observation)"
echo "  4) ugc-ad            (hook → problem → product)"
echo "  5) music-video       (rhythmic, mood-over-plot)"
echo "  6) short-film        (full 3-act narrative)"
echo "  7) romance           (meet-cute → reconciliation)"
echo "  8) horror            (dread buildup, reveal)"
echo "  9) sci-fi            (world-establish, concept, stakes)"
echo " 10) fantasy           (quest, magic, cost)"
echo " 11) western           (stranger, showdown)"
echo " 12) custom"
read -p "> [6] " GENRE_CHOICE
GENRE_CHOICE="${GENRE_CHOICE:-6}"
case "$GENRE_CHOICE" in
  1) GENRE="action-thriller"; DEFAULT_STYLE="villeneuve"; DEFAULT_GRADING="neon-noir"; DEFAULT_SCENES=14 ;;
  2) GENRE="storybook"; DEFAULT_STYLE="miyazaki"; DEFAULT_GRADING="pastel-dream"; DEFAULT_SCENES=12 ;;
  3) GENRE="documentary"; DEFAULT_STYLE="nolan"; DEFAULT_GRADING="desaturated"; DEFAULT_SCENES=10 ;;
  4) GENRE="ugc-ad"; DEFAULT_STYLE="spielberg"; DEFAULT_GRADING="golden-hour"; DEFAULT_SCENES=10 ;;
  5) GENRE="music-video"; DEFAULT_STYLE="wong-kar-wai"; DEFAULT_GRADING="neon-noir"; DEFAULT_SCENES=14 ;;
  6) GENRE="short-film"; DEFAULT_STYLE="villeneuve"; DEFAULT_GRADING="teal-orange"; DEFAULT_SCENES=14 ;;
  7) GENRE="romance"; DEFAULT_STYLE="wes-anderson"; DEFAULT_GRADING="pastel-dream"; DEFAULT_SCENES=12 ;;
  8) GENRE="horror"; DEFAULT_STYLE="fincher"; DEFAULT_GRADING="ice-cold"; DEFAULT_SCENES=12 ;;
  9) GENRE="sci-fi"; DEFAULT_STYLE="villeneuve"; DEFAULT_GRADING="teal-orange"; DEFAULT_SCENES=14 ;;
  10) GENRE="fantasy"; DEFAULT_STYLE="miyazaki"; DEFAULT_GRADING="golden-hour"; DEFAULT_SCENES=14 ;;
  11) GENRE="western"; DEFAULT_STYLE="tarantino"; DEFAULT_GRADING="desaturated"; DEFAULT_SCENES=12 ;;
  *) GENRE="custom"; DEFAULT_STYLE="villeneuve"; DEFAULT_GRADING="neon-noir"; DEFAULT_SCENES=14 ;;
esac

# Q3 — Runtime
echo ""
echo -e "${CYAN}--- Q3 / 10: Target runtime ---${NC}"
echo "Scenes auto-calculated from runtime (15s each)."
echo "  1) 1:00  (4 scenes)"
echo "  2) 2:00  (8 scenes)"
echo "  3) 2:30  (10 scenes)"
echo "  4) 3:00  (12 scenes)"
echo "  5) 3:30  (14 scenes — genre default)"
echo "  6) 4:00  (16 scenes)"
read -p "> [$DEFAULT_SCENES scenes] " RUNTIME_CHOICE
case "$RUNTIME_CHOICE" in
  1) SCENES=4 ;;
  2) SCENES=8 ;;
  3) SCENES=10 ;;
  4) SCENES=12 ;;
  5) SCENES=14 ;;
  6) SCENES=16 ;;
  "") SCENES="$DEFAULT_SCENES" ;;
  *) SCENES="$DEFAULT_SCENES" ;;
esac

# Q4 — Platform
echo ""
echo -e "${CYAN}--- Q4 / 10: Platform ---${NC}"
echo "  1) youtube         (16:9 — default)"
echo "  2) tiktok-vertical (9:16 — vertical)"
echo "  3) instagram-reels (9:16 — vertical)"
echo "  4) youtube-shorts  (9:16 — vertical)"
echo "  5) linkedin        (16:9 or 1:1)"
read -p "> [1] " PLATFORM_CHOICE
case "$PLATFORM_CHOICE" in
  2) PLATFORM="tiktok-vertical" ;;
  3) PLATFORM="instagram-reels" ;;
  4) PLATFORM="youtube-shorts" ;;
  5) PLATFORM="linkedin" ;;
  *) PLATFORM="youtube" ;;
esac

# Q5 — Style
echo ""
echo -e "${CYAN}--- Q5 / 10: Visual style ---${NC}"
echo "Default for $GENRE: $DEFAULT_STYLE"
read -p "Accept [Y] or enter custom style: " STYLE
STYLE="${STYLE:-$DEFAULT_STYLE}"

# Q6 — Color grading
echo ""
echo -e "${CYAN}--- Q6 / 10: Color grading ---${NC}"
echo "Default for $STYLE: $DEFAULT_GRADING"
read -p "Accept [Y] or enter custom grading: " GRADING
GRADING="${GRADING:-$DEFAULT_GRADING}"

# Q7 — Cast (loop)
echo ""
echo -e "${CYAN}--- Q7 / 10: Cast ---${NC}"
echo "Add each character one at a time. Enter blank name to finish."
echo ""
CHAR_FLAGS=""
while true; do
  read -p "Character name (or ENTER to finish): " CHAR_NAME
  if [ -z "$CHAR_NAME" ]; then break; fi
  # Check library first
  echo "  Searching Go Bananas library for \"$CHAR_NAME\"..."
  # (Actual library check would invoke 'vclaw video library clean --name-regex' here)
  read -p "  Is this character in the library? If yes, provide ID. Otherwise leave blank to create: " CHAR_ID
  if [ -z "$CHAR_ID" ]; then
    echo "  Character will be created by the clean-room pipeline during create."
    read -p "  Give a rich description (50–80 words): " CHAR_DESC
    append_auto_create_seed "$AUTO_CREATE_JSON" "$CHAR_NAME" "$CHAR_DESC" "$STYLE $GRADING"
    echo -e "  ${GREEN}✓${NC} Queued \"$CHAR_NAME\" for auto-creation during create"
    continue
  fi
  CHAR_FLAGS="$CHAR_FLAGS --gb-character \"$CHAR_NAME:$CHAR_ID\""
done

# Q8 — Setting (optional, genre defaults)
echo ""
echo -e "${CYAN}--- Q8 / 10: Setting ---${NC}"
read -p "Location / time period (optional, press ENTER to skip): " SETTING

# Q9 — Story shape
echo ""
echo -e "${CYAN}--- Q9 / 10: Story shape ---${NC}"
echo "  1) Auto — LLM expands your premise into beats"
echo "  2) Scene-by-scene — you provide each beat"
echo "  3) 3-act template — you provide inciting/midpoint/climax"
read -p "> [1] " SHAPE_CHOICE

EXTENDED_PROSE="$PREMISE"
if [ -n "$SETTING" ]; then
  EXTENDED_PROSE="$EXTENDED_PROSE. Setting: $SETTING."
fi
case "$SHAPE_CHOICE" in
  2)
    echo "Enter each scene description. Blank line to finish."
    SCENE_NUM=1
    SCENES_PROSE=""
    while true; do
      read -p "Scene $SCENE_NUM: " SCENE
      if [ -z "$SCENE" ]; then break; fi
      SCENES_PROSE="$SCENES_PROSE Scene $SCENE_NUM: $SCENE."
      SCENE_NUM=$((SCENE_NUM + 1))
    done
    EXTENDED_PROSE="$EXTENDED_PROSE$SCENES_PROSE"
    ;;
  3)
    read -p "Inciting incident: " ACT1
    read -p "Midpoint: " ACT2
    read -p "Climax: " ACT3
    EXTENDED_PROSE="$EXTENDED_PROSE. Inciting incident: $ACT1. Midpoint turn: $ACT2. Climax: $ACT3."
    ;;
esac

# Q10 — Review draft intent
echo ""
echo -e "${CYAN}--- Q10 / 10: Review intent prose ---${NC}"
echo ""
echo "----"
echo "$EXTENDED_PROSE"
echo "----"
echo ""
read -p "Edit? [y/N] " EDIT_CHOICE
if [[ "$EDIT_CHOICE" =~ ^[Yy] ]]; then
  TMP_PROSE=$(mktemp --suffix=.txt)
  echo "$EXTENDED_PROSE" > "$TMP_PROSE"
  ${EDITOR:-nano} "$TMP_PROSE"
  EXTENDED_PROSE=$(cat "$TMP_PROSE")
  rm -f "$TMP_PROSE"
fi

# Save project.yaml
cat > "$PROJECT_YAML" <<EOF
project:
  session_id: $SESSION_ID
  created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  genre: $GENRE
  scenes: $SCENES
  style: $STYLE
  grading: $GRADING
  platform: $PLATFORM
premise: |
  $EXTENDED_PROSE
character_flags: |
  $CHAR_FLAGS
EOF
echo ""
echo -e "${GREEN}✓${NC} Session state written to $PROJECT_YAML"

# Summary
echo ""
echo -e "${CYAN}=== Interview Complete — Summary ===${NC}"
echo "  Genre:     $GENRE"
echo "  Runtime:   $SCENES scenes × 15s"
echo "  Style:     $STYLE + $GRADING"
echo "  Platform:  $PLATFORM"
echo "  Chars:     $(echo $CHAR_FLAGS | grep -oE '\-\-gb-character' | wc -l | tr -d ' ') character(s)"
echo "  Premise:   ${EXTENDED_PROSE:0:100}..."
echo ""

# Cost estimate
echo "Estimated cost:"
echo "  Seedance:    $SCENES × \$0.40 = \$$(echo "scale=2; $SCENES * 0.4" | bc 2>/dev/null || echo "?")"
echo "  Gemini:      ~\$0.02"
echo "  ElevenLabs:  ~\$$(echo "scale=2; $SCENES * 0.01" | bc 2>/dev/null || echo "?")"
echo "  Total:       ~\$$(echo "scale=2; $SCENES * 0.41 + 0.02" | bc 2>/dev/null || echo "?")"
echo ""
echo "Wall time:    ~$(echo "scale=0; $SCENES * 4" | bc 2>/dev/null || echo "?") min (mostly Seedance)"
echo ""

read -p "Proceed to Phase 1 (storyboard — no Seedance cost)? [Y/n] " PROCEED
if [[ "$PROCEED" =~ ^[Nn] ]]; then
  echo "Session saved. Resume later with: bash $0 (picks up from $PROJECT_YAML)"
  exit 0
fi

# Phase 1 — write storyboard
echo ""
echo -e "${CYAN}=== Phase 1: Writing storyboard ===${NC}"
phase1_json="$(mktemp)"
AUTO_CREATE_FLAG=""
if [ "$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(data.length));' "$AUTO_CREATE_JSON")" -gt 0 ]; then
  AUTO_CREATE_FLAG="--auto-create-characters \"$AUTO_CREATE_JSON\""
fi
eval node \"$CLI_BIN\" video create \"$EXTENDED_PROSE\" \
  --scenes $SCENES \
  --production-mode director \
  --style $STYLE \
  --color-grading $GRADING \
  --platform $PLATFORM \
  $CHAR_FLAGS \
  $AUTO_CREATE_FLAG \
  --execute > \"$phase1_json\"

STORYBOARD_PATH="$(parse_json_field "$phase1_json" 'review.markdownPath' || true)"
if [ -z "$STORYBOARD_PATH" ]; then
  echo "Storyboard not found. Check errors above."
  rm -f "$phase1_json" "$AUTO_CREATE_JSON"
  exit 1
fi
PROJECT_DIR="$(parse_json_field "$phase1_json" 'workspace.projectDir' || dirname "$STORYBOARD_PATH")"
COST_TOTAL="$(parse_json_field "$phase1_json" 'costEstimate.totalUsd' || true)"

open "$STORYBOARD_PATH" 2>/dev/null || echo "Storyboard: $STORYBOARD_PATH"
echo ""
read -p "Approve storyboard and run Seedance (~\$${COST_TOTAL:-?})? [y/N] " APPROVE
if [[ ! "$APPROVE" =~ ^[Yy] ]]; then
  echo "Storyboard saved at $STORYBOARD_PATH. Re-run with approval when ready."
  rm -f "$phase1_json" "$AUTO_CREATE_JSON"
  exit 0
fi

# Phase 2 — approve + render
echo ""
echo -e "${CYAN}=== Phase 2: Rendering ===${NC}"
phase2_json="$(mktemp)"
VIDEOCLAW_APPROVE_STORYBOARD=1 \
  eval node \"$CLI_BIN\" video create \"$EXTENDED_PROSE\" \
  --scenes $SCENES \
  --production-mode director \
  --style $STYLE \
  --color-grading $GRADING \
  --platform $PLATFORM \
  $CHAR_FLAGS \
  $AUTO_CREATE_FLAG \
  --execute > \"$phase2_json\"

# Phase 3 — re-mux narrated (if needed)
NARRATED="$PROJECT_DIR/final/"*_director_narrated.mp4
if ls $NARRATED 2>/dev/null && ! ffprobe -v error "$NARRATED" 2>/dev/null; then
  echo "Narrated mp4 has broken moov atom. Re-muxing..."
  cd "$PROJECT_DIR"
  ls videos/ | grep narrated | sort | \
    awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > /tmp/concat.txt
  ffmpeg -y -f concat -safe 0 -i /tmp/concat.txt -c copy final/narrated-fixed.mp4
fi

FINAL=$(ls $PROJECT_DIR/final/narrated-fixed.mp4 $PROJECT_DIR/final/*director_narrated.mp4 2>/dev/null | head -1)
open "$FINAL" 2>/dev/null || echo "Final: $FINAL"

echo ""
echo -e "${GREEN}=== Movie complete ===${NC}"
echo "Final: $FINAL"

rm -f "$phase1_json" "$phase2_json" "$AUTO_CREATE_JSON"
