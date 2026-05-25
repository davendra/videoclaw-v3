#!/bin/bash
# Quick single test runner
# Usage: ./tests/quick-test.sh <test-number> [--dry-run] [--visible]
#
# Tests:
#   1 - T2V Landscape
#   2 - T2V Portrait
#   3 - I2V Landscape
#   4 - I2V Portrait (forces landscape)
#   5 - R2V Landscape
#   6 - R2V Portrait
#   7 - Frames Landscape
#   8 - Frames Portrait (forces landscape)
#
# Use 'all' to run comprehensive test suite

cd "$(dirname "$0")/.."

TEST_NUM="${1:-help}"
shift 2>/dev/null || true

MODEL="${MODEL:-fast}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check for test images (for modes 3-8)
check_images() {
    if [[ ! -f "./test-images/landscape-test.jpg" ]] || [[ ! -f "./test-images/portrait-test.jpg" ]]; then
        echo -e "${YELLOW}Error: Test images required in test-images/${NC}"
        echo "  - landscape-test.jpg (16:9)"
        echo "  - portrait-test.jpg (9:16)"
        exit 1
    fi
}

case $TEST_NUM in
    1)
        echo -e "${GREEN}=== Test 1: T2V Landscape ===${NC}"
        bun run google.ts -p "[t2v-landscape] A majestic eagle soaring over mountain peaks at golden hour, cinematic drone shot" \
            -r landscape -m "$MODEL" "$@"
        ;;
    2)
        echo -e "${GREEN}=== Test 2: T2V Portrait ===${NC}"
        bun run google.ts -p "[t2v-portrait] A tall waterfall cascading down a cliff face into a misty pool, vertical framing" \
            -r portrait -m "$MODEL" "$@"
        ;;
    3)
        check_images
        echo -e "${GREEN}=== Test 3: I2V Landscape ===${NC}"
        bun run google.ts -p "[i2v-landscape] image:./test-images/landscape-test.jpg The scene slowly comes to life with gentle wind moving through the grass" \
            -r landscape -m "$MODEL" "$@"
        ;;
    4)
        check_images
        echo -e "${YELLOW}=== Test 4: I2V Portrait (forces landscape) ===${NC}"
        echo "Note: I2V API only supports landscape aspect ratio"
        bun run google.ts -p "[i2v-portrait] image:./test-images/portrait-test.jpg The person slowly turns their head and smiles warmly at the camera" \
            -r portrait -m "$MODEL" "$@"
        ;;
    5)
        check_images
        echo -e "${GREEN}=== Test 5: R2V Landscape ===${NC}"
        bun run google.ts -p "[r2v-landscape] ingredients:./test-images/landscape-test.jpg A peaceful nature scene with gentle camera movement, cinematic" \
            -r landscape -m "$MODEL" "$@"
        ;;
    6)
        check_images
        echo -e "${GREEN}=== Test 6: R2V Portrait ===${NC}"
        echo "Note: R2V portrait support fixed Jan 19, 2026"
        bun run google.ts -p "[r2v-portrait] ingredients:./test-images/portrait-test.jpg A person in the scene with subtle movement, professional quality" \
            -r portrait -m "$MODEL" "$@"
        ;;
    7)
        check_images
        echo -e "${GREEN}=== Test 7: Frames Landscape ===${NC}"
        bun run google.ts -p "[f2v-landscape] frames:./test-images/landscape-test.jpg,./test-images/landscape-test.jpg Smooth cinematic transition with camera movement" \
            -r landscape -m "$MODEL" "$@"
        ;;
    8)
        check_images
        echo -e "${YELLOW}=== Test 8: Frames Portrait (forces landscape) ===${NC}"
        echo "Note: Frames API only supports landscape aspect ratio"
        bun run google.ts -p "[f2v-portrait] frames:./test-images/portrait-test.jpg,./test-images/portrait-test.jpg Smooth vertical transition" \
            -r portrait -m "$MODEL" "$@"
        ;;
    all)
        echo "=== Running Comprehensive Test Suite ==="
        ./tests/test-all-modes.sh "$@"
        ;;
    t2v)
        echo "=== Running T2V Tests ==="
        ./tests/test-t2v.sh "$@"
        ;;
    i2v)
        echo "=== Running I2V Tests ==="
        ./tests/test-i2v.sh "$@"
        ;;
    r2v)
        echo "=== Running R2V Tests ==="
        ./tests/test-r2v.sh "$@"
        ;;
    frames|f2v)
        echo "=== Running Frames Tests ==="
        ./tests/test-f2v.sh "$@"
        ;;
    help|*)
        echo "Usage: ./tests/quick-test.sh <test> [options]"
        echo ""
        echo "Individual Tests:"
        echo "  1   - T2V Landscape"
        echo "  2   - T2V Portrait"
        echo "  3   - I2V Landscape"
        echo -e "  4   - I2V Portrait ${YELLOW}(forces landscape)${NC}"
        echo "  5   - R2V Landscape"
        echo "  6   - R2V Portrait"
        echo "  7   - Frames Landscape"
        echo -e "  8   - Frames Portrait ${YELLOW}(forces landscape)${NC}"
        echo ""
        echo "Test Suites:"
        echo "  all    - Run comprehensive test suite (all modes)"
        echo "  t2v    - Run T2V tests only"
        echo "  i2v    - Run I2V tests only"
        echo "  r2v    - Run R2V tests only"
        echo "  frames - Run Frames tests only"
        echo ""
        echo "Options:"
        echo "  --dry-run   Validate without generating"
        echo "  --visible   Show browser window"
        echo ""
        echo "Environment:"
        echo "  MODEL=fast|free|quality (default: fast)"
        echo ""
        echo "Examples:"
        echo "  ./tests/quick-test.sh 1 --dry-run    # Validate T2V Landscape"
        echo "  ./tests/quick-test.sh r2v --visible  # Run R2V tests with browser"
        echo "  ./tests/quick-test.sh all            # Run all tests"
        ;;
esac
