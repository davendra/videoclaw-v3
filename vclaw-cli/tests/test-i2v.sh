#!/bin/bash
# Image-to-Video Tests Only
# Usage: ./tests/test-i2v.sh [--dry-run] [--visible]
#
# Requires test images:
#   - test-images/landscape-test.jpg
#   - test-images/portrait-test.jpg

cd "$(dirname "$0")/.."

MODEL="${MODEL:-fast}"

# Check for test images
if [[ ! -f "./test-images/landscape-test.jpg" ]]; then
    echo "Error: Missing test-images/landscape-test.jpg"
    echo "Please add a landscape (16:9) test image"
    exit 1
fi

if [[ ! -f "./test-images/portrait-test.jpg" ]]; then
    echo "Error: Missing test-images/portrait-test.jpg"
    echo "Please add a portrait (9:16) test image"
    exit 1
fi

echo "=== I2V Landscape ==="
bun run google.ts -p "[i2v-landscape] image:./test-images/landscape-test.jpg The scene slowly comes to life with gentle wind moving through the grass" \
    -r landscape -m "$MODEL" "$@"

echo ""
echo "=== I2V Portrait ==="
bun run google.ts -p "[i2v-portrait] image:./test-images/portrait-test.jpg The person slowly turns their head and smiles warmly at the camera" \
    -r portrait -m "$MODEL" "$@"
