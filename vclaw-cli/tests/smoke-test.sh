#!/bin/bash
#
# Smoke Test for veo-cli
#
# Validates production readiness by generating 1 video + 1 image
# Cost: ~$0.10 (fast video + imagen-4 image)
#
# Run weekly or before major deployments
#
# Usage:
#   ./tests/smoke-test.sh           # Run full smoke test
#   ./tests/smoke-test.sh --dry-run # Validate without generating
#   ./tests/smoke-test.sh --backend useapi  # Force useapi backend
#   ./tests/smoke-test.sh --backend direct  # Force direct backend
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Parse arguments
DRY_RUN=false
BACKEND=""
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --backend)
      BACKEND="$2"
      shift 2
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [--backend useapi|direct] [--verbose]"
      echo ""
      echo "Validates production readiness by generating test video and image."
      echo ""
      echo "Options:"
      echo "  --dry-run        Validate commands without generating (free)"
      echo "  --backend TYPE   Force backend: useapi or direct"
      echo "  --verbose, -v    Show detailed output"
      echo "  --help           Show this help"
      echo ""
      echo "Cost: ~\$0.10 (1 fast video + 1 imagen-4 image)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo "=============================================="
echo "  veo-cli Smoke Test"
echo "  $(date)"
echo "=============================================="
echo ""

# Determine backend
if [[ -z "$BACKEND" ]]; then
  if [[ -n "${USEAPI_API_TOKEN:-}" ]] && [[ -n "${USEAPI_ACCOUNT_EMAIL:-}" ]]; then
    BACKEND="useapi"
    log_info "Using useapi backend (credentials found)"
  elif [[ -f "cookie.json" ]]; then
    BACKEND="direct"
    log_info "Using direct backend (cookie.json found)"
  else
    log_fail "No credentials found. Set USEAPI_API_TOKEN/USEAPI_ACCOUNT_EMAIL or provide cookie.json"
    exit 1
  fi
fi

# Build common flags
FLAGS="--backend $BACKEND -m fast"
if [[ "$DRY_RUN" == "true" ]]; then
  FLAGS="$FLAGS --dry-run"
  log_info "Dry-run mode: No actual generation will occur"
fi
if [[ "$BACKEND" == "useapi" ]]; then
  FLAGS="$FLAGS --yes"
fi

# Create output directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="$SCRIPT_DIR/output/smoke-$TIMESTAMP"
mkdir -p "$OUTPUT_DIR"

log_info "Output directory: $OUTPUT_DIR"
echo ""

# Track results
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
  local name="$1"
  local cmd="$2"

  log_info "Running: $name"
  if [[ "$VERBOSE" == "true" ]]; then
    echo "Command: $cmd"
  fi

  if eval "$cmd" > "$OUTPUT_DIR/$name.log" 2>&1; then
    log_success "$name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    log_fail "$name (see $OUTPUT_DIR/$name.log)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# ============================================================================
# TEST 1: Video Generation (T2V Landscape)
# ============================================================================

echo "--- Test 1: Video Generation (T2V Landscape) ---"
PROMPT="[smoke-$TIMESTAMP] Quick test: A sunrise over mountains, cinematic"
run_test "video-t2v" "bun run google.ts $FLAGS -p \"$PROMPT\" -r landscape" || true

# ============================================================================
# TEST 2: Video Generation (T2V Portrait)
# ============================================================================

echo ""
echo "--- Test 2: Video Generation (T2V Portrait) ---"
PROMPT="[smoke-$TIMESTAMP] Quick test: A tall waterfall, vertical composition"
run_test "video-t2v-portrait" "bun run google.ts $FLAGS -p \"$PROMPT\" -r portrait" || true

# ============================================================================
# TEST 3: Image Generation (if useapi backend)
# ============================================================================

if [[ "$BACKEND" == "useapi" ]]; then
  echo ""
  echo "--- Test 3: Image Generation (Imagen-4) ---"

  IMAGE_FLAGS=""
  if [[ "$DRY_RUN" == "false" ]]; then
    IMAGE_FLAGS="--yes"
  fi

  run_test "image-gen" "bun run google.ts useapi:image --image-prompt 'Smoke test image: A serene lake at dawn' -r landscape $IMAGE_FLAGS" || true
fi

# ============================================================================
# TEST 4: Health Check
# ============================================================================

echo ""
echo "--- Test 4: Health Check ---"
if [[ "$BACKEND" == "useapi" ]]; then
  run_test "health-check" "bun run google.ts useapi:health" || true
else
  run_test "health-check" "bun run google.ts status" || true
fi

# ============================================================================
# TEST 5: CLI Help (always works)
# ============================================================================

echo ""
echo "--- Test 5: CLI Help ---"
run_test "cli-help" "bun run google.ts help" || true

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "=============================================="
echo "  Smoke Test Complete"
echo "=============================================="
echo ""
echo "Results:"
echo "  Passed: $TESTS_PASSED"
echo "  Failed: $TESTS_FAILED"
echo ""
echo "Output: $OUTPUT_DIR"
echo ""

# List generated files
if [[ "$DRY_RUN" == "false" ]] && [[ -d "$OUTPUT_DIR" ]]; then
  log_info "Generated files:"
  ls -la "$OUTPUT_DIR"/*.log 2>/dev/null || echo "  (no log files)"
  ls -la output-videos/*.mp4 2>/dev/null | tail -3 || echo "  (no videos - may be in project folder)"
fi

# Exit status
if [[ $TESTS_FAILED -gt 0 ]]; then
  log_fail "Some smoke tests failed. Check logs for details."
  exit 1
else
  log_success "All smoke tests passed!"
  exit 0
fi
