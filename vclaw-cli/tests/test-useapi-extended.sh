#!/bin/bash
#
# E2E test script for useapi.net extended features
#
# Tests:
# - Image generation (imagen-4, nano-banana, nano-banana-pro)
# - Image upscaling (2K, 4K)
# - Video to GIF conversion (FREE!)
# - Video upscaling (1080p, 4K)
#
# Usage:
#   ./tests/test-useapi-extended.sh              # Run all tests
#   ./tests/test-useapi-extended.sh --dry-run    # Show commands without running
#   ./tests/test-useapi-extended.sh --images     # Image tests only
#   ./tests/test-useapi-extended.sh --video      # Video processing tests only
#
# Environment:
#   USEAPI_API_TOKEN      - Required: useapi.net API token
#   USEAPI_ACCOUNT_EMAIL  - Required: Google account email
#
# Cost estimate: ~$0.20 for full run

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Parse arguments
DRY_RUN=""
TEST_FILTER="all"
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    --images)
      TEST_FILTER="images"
      shift
      ;;
    --video)
      TEST_FILTER="video"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run] [--images|--video]"
      exit 1
      ;;
  esac
done

# Check environment
if [[ -z "$USEAPI_API_TOKEN" ]]; then
  echo "ERROR: USEAPI_API_TOKEN not set"
  echo "Export your useapi.net API token first:"
  echo "  export USEAPI_API_TOKEN='user:XXXX-XXXXXXXXXX'"
  exit 1
fi

if [[ -z "$USEAPI_ACCOUNT_EMAIL" ]]; then
  echo "ERROR: USEAPI_ACCOUNT_EMAIL not set"
  echo "Export your Google account email:"
  echo "  export USEAPI_ACCOUNT_EMAIL='your-email@gmail.com'"
  exit 1
fi

# Output directory
OUTPUT_DIR="./test-output/extended-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTPUT_DIR"

echo "=== useapi.net Extended Features E2E Test ==="
echo "Filter: $TEST_FILTER"
echo "Output: $OUTPUT_DIR"
echo ""

# Tracking
PASSED=0
FAILED=0
SKIPPED=0
declare -a FAILED_TESTS=()

# Run a test command
run_test() {
  local name="$1"
  shift
  local cmd="$*"

  echo ""
  echo "--- Test: $name ---"
  echo "Command: $cmd"

  if [[ -n "$DRY_RUN" ]]; then
    echo "[DRY RUN] Would execute command"
    ((SKIPPED++))
    return 0
  fi

  if eval "$cmd"; then
    echo "PASS: $name"
    ((PASSED++))
    return 0
  else
    echo "FAIL: $name"
    ((FAILED++))
    FAILED_TESTS+=("$name")
    return 1
  fi
}

# ============================================================================
# Image Generation Tests
# ============================================================================

if [[ "$TEST_FILTER" == "all" || "$TEST_FILTER" == "images" ]]; then
  echo ""
  echo "=== Image Generation Tests ==="

  # Test 1: imagen-4 landscape
  run_test "imagen-4-landscape" \
    "bun run google.ts useapi:image \
      --image-prompt 'A golden retriever puppy in a garden, natural lighting' \
      --image-model imagen-4 \
      -r landscape \
      --yes" || true

  # Test 2: imagen-4 portrait
  run_test "imagen-4-portrait" \
    "bun run google.ts useapi:image \
      --image-prompt 'A tall medieval castle tower, dramatic sky' \
      --image-model imagen-4 \
      -r portrait \
      --yes" || true

  # Test 3: nano-banana with reference image
  run_test "nano-banana-with-ref" \
    "bun run google.ts useapi:image \
      --image-prompt 'The same scene in a different setting' \
      --image-model nano-banana \
      --ref ./test-images/landscape-test.jpg \
      -r landscape \
      --yes" || true

  # Test 4: Multiple images in one request
  run_test "multi-image-request" \
    "bun run google.ts useapi:image \
      --image-prompt 'Abstract geometric pattern in blue and gold' \
      --image-model imagen-4 \
      --image-count 2 \
      -r landscape \
      --yes" || true
fi

# ============================================================================
# Video Processing Tests (require existing video)
# ============================================================================

if [[ "$TEST_FILTER" == "all" || "$TEST_FILTER" == "video" ]]; then
  echo ""
  echo "=== Video Processing Tests ==="
  echo "NOTE: These tests require a video mediaGenerationId."
  echo "      If you have one, set VIDEO_MEDIA_ID environment variable."

  if [[ -n "$VIDEO_MEDIA_ID" ]]; then
    # Test 5: Video to GIF (FREE!)
    run_test "video-to-gif" \
      "bun run google.ts useapi:gif \
        --media-id '$VIDEO_MEDIA_ID' \
        --output-file '$OUTPUT_DIR/preview.gif'" || true

    # Test 6: Video upscale to 1080p (FREE!)
    run_test "video-upscale-1080p" \
      "bun run google.ts useapi:upscale \
        --media-id '$VIDEO_MEDIA_ID' \
        --resolution 1080p" || true
  else
    echo ""
    echo "SKIPPED: Video processing tests (no VIDEO_MEDIA_ID set)"
    echo "To run these tests:"
    echo "  1. Generate a video first"
    echo "  2. Set VIDEO_MEDIA_ID=<mediaGenerationId>"
    echo "  3. Re-run this script with --video"
    ((SKIPPED+=2))
  fi
fi

# ============================================================================
# Image Upscaling Tests (require nano-banana-pro image)
# ============================================================================

if [[ "$TEST_FILTER" == "all" ]]; then
  echo ""
  echo "=== Image Upscaling Tests ==="
  echo "NOTE: Image upscaling only works with nano-banana-pro images."

  if [[ -n "$IMAGE_MEDIA_ID" ]]; then
    # Test 7: Image upscale to 2K (FREE!)
    run_test "image-upscale-2k" \
      "bun run google.ts useapi:image:upscale \
        --media-id '$IMAGE_MEDIA_ID' \
        --resolution 2k" || true
  else
    echo ""
    echo "SKIPPED: Image upscaling tests (no IMAGE_MEDIA_ID set)"
    echo "To run these tests:"
    echo "  1. Generate an image with nano-banana-pro first"
    echo "  2. Set IMAGE_MEDIA_ID=<mediaGenerationId>"
    echo "  3. Re-run this script"
    ((SKIPPED++))
  fi
fi

# ============================================================================
# Results
# ============================================================================

echo ""
echo "=== Test Results ==="
echo "Passed:  $PASSED"
echo "Failed:  $FAILED"
echo "Skipped: $SKIPPED"

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "Failed tests:"
  for test in "${FAILED_TESTS[@]}"; do
    echo "  - $test"
  done
fi

echo ""
echo "Output directory: $OUTPUT_DIR"

# Exit with failure if any tests failed
[[ $FAILED -eq 0 ]] && exit 0 || exit 1
