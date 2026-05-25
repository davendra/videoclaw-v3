#!/bin/bash
# Frames-to-Video Tests
# Usage: ./tests/test-f2v.sh [--dry-run] [--visible]
#
# Tests Frames mode with both landscape and portrait orientations.
# Frames mode uses start + end frames to generate video transitions.
#
# Expected Results:
#   - Frames Landscape: ✅ Video generated (full support)
#   - Frames Portrait:  ⚠️ Forces landscape (API limitation)
#
# Note: The Frames API only supports landscape aspect ratio.
# Portrait requests are automatically converted to landscape.
#
# Requires test images:
#   - test-images/landscape-test.jpg
#   - test-images/portrait-test.jpg

cd "$(dirname "$0")/.."

MODEL="${MODEL:-fast}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check for test images
if [[ ! -f "./test-images/landscape-test.jpg" ]]; then
    echo -e "${YELLOW}Error: Missing test-images/landscape-test.jpg${NC}"
    echo "Please add a landscape (16:9) test image"
    exit 1
fi

if [[ ! -f "./test-images/portrait-test.jpg" ]]; then
    echo -e "${YELLOW}Error: Missing test-images/portrait-test.jpg${NC}"
    echo "Please add a portrait (9:16) test image"
    exit 1
fi

echo "========================================"
echo "  Frames-to-Video (F2V) Tests"
echo "========================================"
echo ""
echo "Expected:"
echo "  - Landscape: Video generated successfully"
echo "  - Portrait:  Forces landscape (API limitation)"
echo ""

echo -e "${GREEN}=== F2V Landscape ===${NC}"
echo "Using start and end frames to generate landscape transition"
bun run google.ts -p "[f2v-landscape] frames:./test-images/landscape-test.jpg,./test-images/landscape-test.jpg Smooth cinematic transition with camera movement" \
    -r landscape -m "$MODEL" "$@"

echo ""
echo -e "${YELLOW}=== F2V Portrait (API forces landscape) ===${NC}"
echo "Note: Frames API only supports landscape - portrait will be forced to landscape"
bun run google.ts -p "[f2v-portrait] frames:./test-images/portrait-test.jpg,./test-images/portrait-test.jpg Smooth vertical transition" \
    -r portrait -m "$MODEL" "$@"

echo ""
echo "========================================"
echo -e "${GREEN}  F2V Tests Complete!${NC}"
echo "========================================"
echo ""
echo -e "${YELLOW}Note: F2V portrait test generates landscape due to API limitation${NC}"
