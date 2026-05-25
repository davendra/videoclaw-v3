#!/bin/bash
#
# Comprehensive veo-cli Test Suite
#
# Tests all video generation modes across both backends and orientations.
#
# Test Matrix:
#   - 4 modes (T2V, R2V, I2V, Frames)
#   - 2 orientations (landscape, portrait)
#   - 2 backends (direct, useapi)
#   = 16 video tests (some skipped due to API limitations)
#
# Plus:
#   - 4 extended feature tests (image gen, GIF, upscale)
#   = ~20 total tests
#
# Usage:
#   ./tests/test-comprehensive.sh                    # Run with useapi backend
#   ./tests/test-comprehensive.sh direct             # Run with direct backend
#   ./tests/test-comprehensive.sh useapi --dry-run   # Dry run
#   ./tests/test-comprehensive.sh all                # Run both backends
#
# Environment:
#   For direct backend:
#     - cookie.json must exist
#
#   For useapi backend:
#     - USEAPI_API_TOKEN
#     - USEAPI_ACCOUNT_EMAIL
#
# Cost estimate:
#   - useapi: ~$0.85 (16 videos * $0.05 + overhead)
#   - direct: Free (but uses Google account credits)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Parse arguments
BACKEND="${1:-useapi}"
DRY_RUN=""
if [[ "$2" == "--dry-run" ]] || [[ "$1" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  if [[ "$1" == "--dry-run" ]]; then
    BACKEND="useapi"
  fi
fi

# Output directory
OUTPUT_DIR="./test-output/comprehensive-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTPUT_DIR"

echo "=== Comprehensive veo-cli Test Suite ==="
echo "Backend: $BACKEND"
echo "Dry Run: ${DRY_RUN:-no}"
echo "Output:  $OUTPUT_DIR"
echo ""

# Validate backend requirements
validate_backend() {
  local backend="$1"

  if [[ "$backend" == "direct" ]]; then
    if [[ ! -f "cookie.json" ]]; then
      echo "ERROR: cookie.json not found (required for direct backend)"
      echo "Run with --visible to login first"
      return 1
    fi
  elif [[ "$backend" == "useapi" ]]; then
    if [[ -z "$USEAPI_API_TOKEN" ]] || [[ -z "$USEAPI_ACCOUNT_EMAIL" ]]; then
      echo "ERROR: useapi backend requires environment variables:"
      echo "  export USEAPI_API_TOKEN='user:XXXX-XXXXXXXXXX'"
      echo "  export USEAPI_ACCOUNT_EMAIL='your-email@gmail.com'"
      return 1
    fi
  else
    echo "ERROR: Unknown backend: $backend"
    echo "Valid backends: direct, useapi, all"
    return 1
  fi

  return 0
}

# Tracking
PASSED=0
FAILED=0
SKIPPED=0
declare -a RESULTS=()

# Run a single test
run_test() {
  local name="$1"
  local mode="$2"
  local orientation="$3"
  local backend="$4"
  local prompt="$5"
  local should_skip="${6:-false}"

  local skip_reason=""

  # Check if this test should be skipped
  if [[ "$should_skip" == "true" ]]; then
    skip_reason="Not supported by $backend backend"
  fi

  # I2V and Frames portrait not supported on direct backend
  if [[ "$backend" == "direct" ]] && [[ "$orientation" == "portrait" ]]; then
    if [[ "$mode" == "i2v" ]] || [[ "$mode" == "frames" ]]; then
      skip_reason="I2V/Frames portrait not supported via direct API"
    fi
  fi

  echo ""
  echo "--- Test: $name ---"
  echo "Mode: $mode | Orientation: $orientation | Backend: $backend"

  if [[ -n "$skip_reason" ]]; then
    echo "SKIP: $skip_reason"
    ((SKIPPED++))
    RESULTS+=("SKIP|$name|$skip_reason")
    return 0
  fi

  local cmd="bun run google.ts --backend $backend -p '[$name] $prompt' -r $orientation -m fast --yes $DRY_RUN"
  echo "Command: $cmd"

  if [[ -n "$DRY_RUN" ]]; then
    echo "[DRY RUN] Would execute"
    ((SKIPPED++))
    RESULTS+=("DRY|$name|dry run")
    return 0
  fi

  if eval "$cmd"; then
    echo "PASS: $name"
    ((PASSED++))
    RESULTS+=("PASS|$name|")
    return 0
  else
    echo "FAIL: $name"
    ((FAILED++))
    RESULTS+=("FAIL|$name|execution failed")
    return 1
  fi
}

# Run tests for a specific backend
run_backend_tests() {
  local backend="$1"

  if ! validate_backend "$backend"; then
    echo "Skipping $backend backend tests due to missing requirements"
    return 1
  fi

  echo ""
  echo "=========================================="
  echo " Running tests with $backend backend"
  echo "=========================================="

  # T2V Tests (both orientations work on both backends)
  run_test "t2v-land-$backend" "t2v" "landscape" "$backend" \
    "A sunset over mountains, golden hour, cinematic" || true

  run_test "t2v-port-$backend" "t2v" "portrait" "$backend" \
    "A tall lighthouse against a stormy sky, dramatic" || true

  # R2V Tests (both orientations work on both backends after Jan 19 fix)
  run_test "r2v-land-$backend" "r2v" "landscape" "$backend" \
    "ingredients:./test-images/landscape-test.jpg A serene forest scene at dawn" || true

  run_test "r2v-port-$backend" "r2v" "portrait" "$backend" \
    "ingredients:./test-images/portrait-test.jpg A city skyline at night" || true

  # I2V Tests (portrait only works on useapi)
  run_test "i2v-land-$backend" "i2v" "landscape" "$backend" \
    "image:./test-images/landscape-test.jpg The scene slowly comes alive" || true

  run_test "i2v-port-$backend" "i2v" "portrait" "$backend" \
    "image:./test-images/portrait-test.jpg Gentle motion begins" || true

  # Frames Tests (portrait only works on useapi)
  run_test "frames-land-$backend" "frames" "landscape" "$backend" \
    "frames:./test-images/landscape-test.jpg,./test-images/landscape-test.jpg Smooth transition" || true

  run_test "frames-port-$backend" "frames" "portrait" "$backend" \
    "frames:./test-images/portrait-test.jpg,./test-images/portrait-test.jpg Transition effect" || true
}

# Run extended feature tests (useapi only)
run_extended_tests() {
  echo ""
  echo "=========================================="
  echo " Extended Features (useapi only)"
  echo "=========================================="

  if [[ -z "$USEAPI_API_TOKEN" ]]; then
    echo "SKIP: Extended features require useapi credentials"
    ((SKIPPED+=4))
    return 0
  fi

  echo ""
  echo "--- Test: image-gen-landscape ---"
  local img_cmd="bun run google.ts useapi:image --image-prompt 'A test cat in a garden' -r landscape --yes $DRY_RUN"
  echo "Command: $img_cmd"

  if [[ -n "$DRY_RUN" ]]; then
    echo "[DRY RUN]"
    ((SKIPPED++))
  elif eval "$img_cmd"; then
    echo "PASS: image-gen-landscape"
    ((PASSED++))
    RESULTS+=("PASS|image-gen-landscape|")
  else
    echo "FAIL: image-gen-landscape"
    ((FAILED++))
    RESULTS+=("FAIL|image-gen-landscape|execution failed")
  fi

  echo ""
  echo "--- Test: image-gen-portrait ---"
  img_cmd="bun run google.ts useapi:image --image-prompt 'A tall tower at sunset' -r portrait --yes $DRY_RUN"
  echo "Command: $img_cmd"

  if [[ -n "$DRY_RUN" ]]; then
    echo "[DRY RUN]"
    ((SKIPPED++))
  elif eval "$img_cmd"; then
    echo "PASS: image-gen-portrait"
    ((PASSED++))
    RESULTS+=("PASS|image-gen-portrait|")
  else
    echo "FAIL: image-gen-portrait"
    ((FAILED++))
    RESULTS+=("FAIL|image-gen-portrait|execution failed")
  fi
}

# Main execution
case "$BACKEND" in
  direct)
    run_backend_tests "direct"
    ;;
  useapi)
    run_backend_tests "useapi"
    run_extended_tests
    ;;
  all)
    run_backend_tests "direct" || true
    run_backend_tests "useapi" || true
    run_extended_tests
    ;;
  *)
    echo "ERROR: Unknown backend: $BACKEND"
    echo "Usage: $0 [direct|useapi|all] [--dry-run]"
    exit 1
    ;;
esac

# Results Summary
echo ""
echo "=========================================="
echo " Test Results Summary"
echo "=========================================="
echo ""
echo "Passed:  $PASSED"
echo "Failed:  $FAILED"
echo "Skipped: $SKIPPED"
echo "Total:   $((PASSED + FAILED + SKIPPED))"
echo ""

if [[ $FAILED -gt 0 ]] || [[ $PASSED -gt 0 ]] || [[ $SKIPPED -gt 0 ]]; then
  echo "Detailed Results:"
  echo "-----------------"
  printf "%-6s | %-25s | %s\n" "Status" "Test Name" "Notes"
  printf "%-6s-+-%-25s-+-%s\n" "------" "-------------------------" "--------------------"
  for result in "${RESULTS[@]}"; do
    IFS='|' read -r status name notes <<< "$result"
    printf "%-6s | %-25s | %s\n" "$status" "$name" "$notes"
  done
fi

echo ""
echo "Output directory: $OUTPUT_DIR"

# Exit code
if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "Some tests FAILED. Review output above."
  exit 1
else
  echo ""
  echo "All tests passed or skipped as expected."
  exit 0
fi
