#!/bin/bash
# R2V (References/Ingredients) Tests
# Usage: ./tests/test-r2v.sh [--dry-run] [--visible]
#
# Tests R2V mode with both landscape and portrait orientations.
# R2V mode uses 1-3 reference images to guide video generation.
#
# Expected Results:
#   - R2V Landscape: ✅ Video generated (full support)
#   - R2V Portrait:  ✅ Video generated (fixed Jan 19, 2026)
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
echo "  R2V (References/Ingredients) Tests"
echo "========================================"
echo ""
echo "Expected: Both orientations should generate successfully"
echo "Note: R2V portrait support was fixed Jan 19, 2026"
echo ""

echo -e "${GREEN}=== R2V Landscape ===${NC}"
echo "Using reference image to guide landscape video generation"
bun run google.ts -p "[r2v-landscape] ingredients:./test-images/landscape-test.jpg A peaceful nature scene with gentle camera movement, cinematic" \
    -r landscape -m "$MODEL" "$@"

echo ""
echo -e "${GREEN}=== R2V Portrait ===${NC}"
echo "Using reference image to guide portrait video generation"
bun run google.ts -p "[r2v-portrait] ingredients:./test-images/portrait-test.jpg A person in the scene with subtle movement, professional quality" \
    -r portrait -m "$MODEL" "$@"

echo ""
echo "========================================"
echo -e "${GREEN}  R2V Tests Complete!${NC}"
echo "========================================"
