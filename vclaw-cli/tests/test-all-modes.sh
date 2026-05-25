#!/bin/bash
# Comprehensive Video Mode Test Suite
# Usage: ./tests/test-all-modes.sh [--dry-run] [--visible] [--mode MODE] [--skip-mode MODE]
#
# Tests all 4 video generation modes (T2V, R2V, I2V, Frames) with both
# landscape and portrait orientations, documenting expected behavior.
#
# Expected Results:
# ┌────────┬─────────────┬─────────────────────┬────────────────────────────┐
# │ Mode   │ Orientation │ Expected Result     │ Notes                      │
# ├────────┼─────────────┼─────────────────────┼────────────────────────────┤
# │ T2V    │ Landscape   │ ✅ Video generated  │ Full support               │
# │ T2V    │ Portrait    │ ✅ Video generated  │ Full support               │
# │ R2V    │ Landscape   │ ✅ Video generated  │ Fixed Jan 19, 2026         │
# │ R2V    │ Portrait    │ ✅ Video generated  │ Fixed Jan 19, 2026         │
# │ I2V    │ Landscape   │ ✅ Video generated  │ Full support               │
# │ I2V    │ Portrait    │ ⚠️ Forces landscape │ API limitation             │
# │ Frames │ Landscape   │ ✅ Video generated  │ Full support               │
# │ Frames │ Portrait    │ ⚠️ Forces landscape │ API limitation             │
# └────────┴─────────────┴─────────────────────┴────────────────────────────┘
#
# Requires test images:
#   - test-images/landscape-test.jpg
#   - test-images/portrait-test.jpg

set -e
cd "$(dirname "$0")/.."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Defaults
MODEL="${MODEL:-fast}"
DRY_RUN=""
VISIBLE=""
RUN_T2V=true
RUN_R2V=true
RUN_I2V=true
RUN_FRAMES=true
ONLY_MODE=""

# Track results
declare -a TEST_RESULTS
TESTS_RUN=0
TESTS_PASSED=0
TESTS_WARNED=0
TESTS_FAILED=0

# Parse arguments
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
        --model)
            MODEL="$2"
            shift 2
            ;;
        --mode)
            ONLY_MODE="$2"
            RUN_T2V=false
            RUN_R2V=false
            RUN_I2V=false
            RUN_FRAMES=false
            case $2 in
                t2v) RUN_T2V=true ;;
                r2v) RUN_R2V=true ;;
                i2v) RUN_I2V=true ;;
                frames|f2v) RUN_FRAMES=true ;;
                *) echo "Unknown mode: $2"; exit 1 ;;
            esac
            shift 2
            ;;
        --skip-mode)
            case $2 in
                t2v) RUN_T2V=false ;;
                r2v) RUN_R2V=false ;;
                i2v) RUN_I2V=false ;;
                frames|f2v) RUN_FRAMES=false ;;
                *) echo "Unknown mode: $2"; exit 1 ;;
            esac
            shift 2
            ;;
        --help|-h)
            echo "Usage: ./tests/test-all-modes.sh [options]"
            echo ""
            echo "Tests all video generation modes (T2V, R2V, I2V, Frames)"
            echo "with both landscape and portrait orientations."
            echo ""
            echo "Options:"
            echo "  --dry-run         Validate prompts without generating"
            echo "  --visible         Show browser window"
            echo "  --model MODEL     Model: fast (default), free, quality"
            echo "  --mode MODE       Run only specific mode (t2v, r2v, i2v, frames)"
            echo "  --skip-mode MODE  Skip specific mode"
            echo "  -h, --help        Show this help"
            echo ""
            echo "Environment:"
            echo "  MODEL=fast|free|quality  Override default model"
            echo ""
            echo "Examples:"
            echo "  ./tests/test-all-modes.sh --dry-run      # Validate all prompts"
            echo "  ./tests/test-all-modes.sh --mode t2v     # Run only T2V tests"
            echo "  ./tests/test-all-modes.sh --skip-mode frames  # Skip Frames tests"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage"
            exit 1
            ;;
    esac
done

# Check for test images
check_images() {
    local missing=false
    if [[ ! -f "./test-images/landscape-test.jpg" ]]; then
        echo -e "${YELLOW}Missing: test-images/landscape-test.jpg (16:9)${NC}"
        missing=true
    fi
    if [[ ! -f "./test-images/portrait-test.jpg" ]]; then
        echo -e "${YELLOW}Missing: test-images/portrait-test.jpg (9:16)${NC}"
        missing=true
    fi
    if $missing; then
        return 1
    fi
    return 0
}

# Run a single test and track result
run_test() {
    local name="$1"
    local expected="$2"  # "pass" or "warn" (warn = forces landscape)
    shift 2

    echo ""
    echo -e "${BLUE}─────────────────────────────────────────${NC}"
    echo -e "${BOLD}Test: $name${NC}"
    echo -e "${BLUE}─────────────────────────────────────────${NC}"

    ((TESTS_RUN++))

    if bun run google.ts "$@" $DRY_RUN $VISIBLE; then
        if [[ "$expected" == "warn" ]]; then
            echo -e "${YELLOW}⚠️  $name: Generated (forced landscape)${NC}"
            ((TESTS_WARNED++))
            TEST_RESULTS+=("⚠️  $name (forced landscape)")
        else
            echo -e "${GREEN}✅ $name: Passed${NC}"
            ((TESTS_PASSED++))
            TEST_RESULTS+=("✅ $name")
        fi
    else
        echo -e "${RED}❌ $name: Failed${NC}"
        ((TESTS_FAILED++))
        TEST_RESULTS+=("❌ $name")
    fi
}

# Print header
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}           Comprehensive Video Mode Test Suite${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Settings:"
echo "  Model:    $MODEL"
echo "  Dry Run:  ${DRY_RUN:-no}"
echo "  Visible:  ${VISIBLE:-no}"
if [[ -n "$ONLY_MODE" ]]; then
    echo "  Mode:     $ONLY_MODE only"
fi
echo ""

# Check test images for modes that need them
NEED_IMAGES=false
if $RUN_R2V || $RUN_I2V || $RUN_FRAMES; then
    NEED_IMAGES=true
fi

if $NEED_IMAGES; then
    echo "Checking test images..."
    if ! check_images; then
        echo ""
        echo -e "${YELLOW}Some tests require images in test-images/ directory${NC}"
        if ! $RUN_T2V; then
            echo "Cannot continue without test images for selected mode(s)"
            exit 1
        fi
        echo "Continuing with T2V tests only..."
        RUN_R2V=false
        RUN_I2V=false
        RUN_FRAMES=false
    else
        echo -e "${GREEN}Test images found ✓${NC}"
    fi
fi

# ==========================================
# TEXT-TO-VIDEO TESTS
# ==========================================
if $RUN_T2V; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     TEXT-TO-VIDEO (T2V) TESTS          ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo "Expected: Both orientations fully supported"

    run_test "T2V Landscape" "pass" \
        -p "[t2v-landscape] A majestic eagle soaring over mountain peaks at golden hour, cinematic drone shot" \
        -r landscape -m "$MODEL"

    run_test "T2V Portrait" "pass" \
        -p "[t2v-portrait] A tall waterfall cascading down a cliff face into a misty pool, vertical framing" \
        -r portrait -m "$MODEL"
fi

# ==========================================
# REFERENCES-TO-VIDEO (R2V) TESTS
# ==========================================
if $RUN_R2V; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   REFERENCES-TO-VIDEO (R2V) TESTS      ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo "Expected: Both orientations supported (fixed Jan 19, 2026)"

    run_test "R2V Landscape" "pass" \
        -p "[r2v-landscape] ingredients:./test-images/landscape-test.jpg A peaceful nature scene with gentle camera movement, cinematic" \
        -r landscape -m "$MODEL"

    run_test "R2V Portrait" "pass" \
        -p "[r2v-portrait] ingredients:./test-images/portrait-test.jpg A person in the scene with subtle movement, professional quality" \
        -r portrait -m "$MODEL"
fi

# ==========================================
# IMAGE-TO-VIDEO (I2V) TESTS
# ==========================================
if $RUN_I2V; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     IMAGE-TO-VIDEO (I2V) TESTS         ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo "Expected: Landscape supported, Portrait forces landscape"

    run_test "I2V Landscape" "pass" \
        -p "[i2v-landscape] image:./test-images/landscape-test.jpg The scene slowly comes to life with gentle wind moving through the grass" \
        -r landscape -m "$MODEL"

    run_test "I2V Portrait (API forces landscape)" "warn" \
        -p "[i2v-portrait] image:./test-images/portrait-test.jpg The person slowly turns their head and smiles warmly at the camera" \
        -r portrait -m "$MODEL"
fi

# ==========================================
# FRAMES-TO-VIDEO (F2V) TESTS
# ==========================================
if $RUN_FRAMES; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     FRAMES-TO-VIDEO (F2V) TESTS        ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo "Expected: Landscape supported, Portrait forces landscape"

    run_test "Frames Landscape" "pass" \
        -p "[f2v-landscape] frames:./test-images/landscape-test.jpg,./test-images/landscape-test.jpg Smooth cinematic transition with camera movement" \
        -r landscape -m "$MODEL"

    run_test "Frames Portrait (API forces landscape)" "warn" \
        -p "[f2v-portrait] frames:./test-images/portrait-test.jpg,./test-images/portrait-test.jpg Smooth vertical transition" \
        -r portrait -m "$MODEL"
fi

# ==========================================
# SUMMARY
# ==========================================
echo ""
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}                      TEST SUMMARY${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Print results table
echo "Results:"
echo "─────────────────────────────────────────"
for result in "${TEST_RESULTS[@]}"; do
    echo "  $result"
done
echo "─────────────────────────────────────────"
echo ""

# Print counts
echo "Statistics:"
echo "  Total:    $TESTS_RUN tests"
echo -e "  Passed:   ${GREEN}$TESTS_PASSED${NC}"
if [[ $TESTS_WARNED -gt 0 ]]; then
    echo -e "  Warnings: ${YELLOW}$TESTS_WARNED${NC} (API forced landscape)"
fi
if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "  Failed:   ${RED}$TESTS_FAILED${NC}"
fi
echo ""

# Expected behavior table
echo "Expected Behavior Reference:"
echo "┌────────┬─────────────┬─────────────────────┬────────────────────┐"
echo "│ Mode   │ Orientation │ Expected            │ Notes              │"
echo "├────────┼─────────────┼─────────────────────┼────────────────────┤"
echo "│ T2V    │ Landscape   │ ✅ Video generated  │ Full support       │"
echo "│ T2V    │ Portrait    │ ✅ Video generated  │ Full support       │"
echo "│ R2V    │ Landscape   │ ✅ Video generated  │ Fixed Jan 19       │"
echo "│ R2V    │ Portrait    │ ✅ Video generated  │ Fixed Jan 19       │"
echo "│ I2V    │ Landscape   │ ✅ Video generated  │ Full support       │"
echo "│ I2V    │ Portrait    │ ⚠️ Forces landscape │ API limitation     │"
echo "│ Frames │ Landscape   │ ✅ Video generated  │ Full support       │"
echo "│ Frames │ Portrait    │ ⚠️ Forces landscape │ API limitation     │"
echo "└────────┴─────────────┴─────────────────────┴────────────────────┘"
echo ""

if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
else
    echo -e "${GREEN}All tests completed successfully!${NC}"
fi
