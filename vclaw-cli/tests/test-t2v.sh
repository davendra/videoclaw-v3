#!/bin/bash
# Text-to-Video Tests Only
# Usage: ./tests/test-t2v.sh [--dry-run] [--visible]

cd "$(dirname "$0")/.."

MODEL="${MODEL:-fast}"

echo "=== T2V Landscape ==="
bun run google.ts -p "[t2v-landscape] A majestic eagle soaring over mountain peaks at golden hour, cinematic drone shot" \
    -r landscape -m "$MODEL" "$@"

echo ""
echo "=== T2V Portrait ==="
bun run google.ts -p "[t2v-portrait] A tall waterfall cascading down a cliff face into a misty pool, vertical framing" \
    -r portrait -m "$MODEL" "$@"
