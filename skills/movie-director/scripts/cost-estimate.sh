#!/usr/bin/env bash
# cost-estimate.sh — dollar-amount estimator for a planned movie run.
# Use to decide whether to proceed before Phase 2 burns Seedance credits.

set -e

# Defaults
SCENES="${1:-14}"
CLIP_DURATION="${2:-15}"
NEW_CHARS="${3:-0}"
WITH_NARRATION="${4:-true}"

# Per-unit costs (tune as pricing changes)
SEEDANCE_PER_10S="0.27"
SEEDANCE_PER_15S="0.40"
SEEDANCE_PER_20S="0.53"
GEMINI_SCRIPT_PER_RUN="0.01"
GEMINI_DECOMP_PER_RUN="0.02"
GO_BANANAS_PER_NEW_CHAR="0.05"
ELEVENLABS_PER_SCENE="0.01"

# Scale Seedance cost to clip duration
if [ "$CLIP_DURATION" -le 10 ]; then
  SEEDANCE_PER=$SEEDANCE_PER_10S
elif [ "$CLIP_DURATION" -le 15 ]; then
  SEEDANCE_PER=$SEEDANCE_PER_15S
else
  SEEDANCE_PER=$SEEDANCE_PER_20S
fi

SEEDANCE_TOTAL=$(echo "scale=2; $SCENES * $SEEDANCE_PER" | bc)
GEMINI_TOTAL=$(echo "scale=2; $GEMINI_SCRIPT_PER_RUN + $GEMINI_DECOMP_PER_RUN" | bc)
GO_BANANAS_TOTAL=$(echo "scale=2; $NEW_CHARS * $GO_BANANAS_PER_NEW_CHAR" | bc)

if [ "$WITH_NARRATION" = "true" ]; then
  ELEVENLABS_TOTAL=$(echo "scale=2; $SCENES * $ELEVENLABS_PER_SCENE" | bc)
else
  ELEVENLABS_TOTAL="0.00"
fi

TOTAL=$(echo "scale=2; $SEEDANCE_TOTAL + $GEMINI_TOTAL + $GO_BANANAS_TOTAL + $ELEVENLABS_TOTAL" | bc)

# Wall time estimate
SEEDANCE_MIN=$((SCENES * 4))  # ~4 min per clip
TOTAL_MIN=$((SEEDANCE_MIN + 5))  # +5 for stitch + narration bake

echo "=== Movie Director — Cost Estimate ==="
echo ""
echo "Scenes:            $SCENES"
echo "Clip duration:     ${CLIP_DURATION}s"
echo "New characters:    $NEW_CHARS"
echo "Narration:         $WITH_NARRATION"
echo ""
echo "--- Cost breakdown ---"
printf "Seedance:          \$%s × %d = \$%s\n" "$SEEDANCE_PER" "$SCENES" "$SEEDANCE_TOTAL"
printf "Gemini (all):      \$%s\n" "$GEMINI_TOTAL"
printf "Go Bananas chars:  \$%s × %d = \$%s\n" "$GO_BANANAS_PER_NEW_CHAR" "$NEW_CHARS" "$GO_BANANAS_TOTAL"
printf "ElevenLabs TTS:    \$%s × %d = \$%s\n" "$ELEVENLABS_PER_SCENE" "$SCENES" "$ELEVENLABS_TOTAL"
echo "                   ──────"
printf "Total:             \$%s\n" "$TOTAL"
echo ""
echo "--- Wall time ---"
echo "Script gen:        ~20s"
echo "Decomposition:     ~15s"
echo "Seedance (seq):    ~${SEEDANCE_MIN} min"
echo "Stitch + narrate:  ~3 min"
echo "                   ──────"
echo "Total:             ~${TOTAL_MIN} min"
