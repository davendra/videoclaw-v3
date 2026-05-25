#!/bin/bash
# veo-cli Test Runner
# Runs all video generation tests with fast model

set -e
cd "$(dirname "$0")/.."

echo "========================================"
echo "  veo-cli Test Suite"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check for test images
check_images() {
    if [[ ! -f "./test-images/landscape-test.jpg" ]] || [[ ! -f "./test-images/portrait-test.jpg" ]]; then
        echo -e "${YELLOW}Warning: Test images not found in ./test-images/${NC}"
        echo "For I2V tests, please add:"
        echo "  - test-images/landscape-test.jpg (16:9 landscape image)"
        echo "  - test-images/portrait-test.jpg (9:16 portrait image)"
        echo ""
        return 1
    fi
    return 0
}

# Parse arguments
DRY_RUN=""
VISIBLE=""
MODEL="fast"
RUN_T2V=true
RUN_I2V=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        --visible)
            VISIBLE="--visible"
            shift
            ;;
        --t2v-only)
            RUN_I2V=false
            shift
            ;;
        --i2v-only)
            RUN_T2V=false
            shift
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: ./tests/run-tests.sh [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run     Validate prompts without generating"
            echo "  --visible     Show browser window"
            echo "  --t2v-only    Run only text-to-video tests"
            echo "  --i2v-only    Run only image-to-video tests"
            echo "  --model       Model: fast (default), free, quality"
            echo "  -h, --help    Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "Settings:"
echo "  Model: $MODEL"
echo "  Dry Run: ${DRY_RUN:-no}"
echo "  Visible: ${VISIBLE:-no}"
echo ""

# ==========================================
# TEXT-TO-VIDEO TESTS
# ==========================================

if $RUN_T2V; then
    echo -e "${GREEN}=== TEXT-TO-VIDEO TESTS ===${NC}"
    echo ""

    echo "Test 1: T2V Landscape"
    echo "-------------------------------------------"
    bun run google.ts -p "[t2v-landscape] A majestic eagle soaring over mountain peaks at golden hour, cinematic drone shot" \
        -r landscape -m "$MODEL" $DRY_RUN $VISIBLE
    echo ""

    echo "Test 2: T2V Portrait"
    echo "-------------------------------------------"
    bun run google.ts -p "[t2v-portrait] A tall waterfall cascading down a cliff face into a misty pool, vertical framing" \
        -r portrait -m "$MODEL" $DRY_RUN $VISIBLE
    echo ""
fi

# ==========================================
# IMAGE-TO-VIDEO TESTS
# ==========================================

if $RUN_I2V; then
    echo -e "${GREEN}=== IMAGE-TO-VIDEO TESTS ===${NC}"
    echo ""

    if check_images; then
        echo "Test 3: I2V Landscape"
        echo "-------------------------------------------"
        bun run google.ts -p "[i2v-landscape] image:./test-images/landscape-test.jpg The scene slowly comes to life with gentle wind" \
            -r landscape -m "$MODEL" $DRY_RUN $VISIBLE
        echo ""

        echo "Test 4: I2V Portrait"
        echo "-------------------------------------------"
        bun run google.ts -p "[i2v-portrait] image:./test-images/portrait-test.jpg The person slowly turns and smiles warmly" \
            -r portrait -m "$MODEL" $DRY_RUN $VISIBLE
        echo ""
    else
        echo -e "${YELLOW}Skipping I2V tests - add test images first${NC}"
        echo ""
    fi
fi

echo "========================================"
echo -e "${GREEN}  Tests Complete!${NC}"
echo "========================================"
