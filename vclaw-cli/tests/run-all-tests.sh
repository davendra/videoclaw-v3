#!/bin/bash
#
# Master Test Runner for veo-cli
# Creates structured output directories with timestamps and detailed reporting
#
# Usage:
#   ./tests/run-all-tests.sh              # Run all tests
#   ./tests/run-all-tests.sh --unit       # Unit tests only
#   ./tests/run-all-tests.sh --integration # Integration tests only
#   ./tests/run-all-tests.sh --e2e        # E2E shell tests only
#   ./tests/run-all-tests.sh --quick      # Quick unit tests only
#
# Output:
#   tests/output/YYYY-MM-DD_HH-MM-SS/
#     ├── summary.json
#     ├── summary.md
#     ├── unit/
#     ├── integration/
#     └── e2e/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Parse arguments
RUN_UNIT=true
RUN_INTEGRATION=true
RUN_E2E=true
QUICK_MODE=false
COVERAGE_ENABLED=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --unit)
      RUN_UNIT=true
      RUN_INTEGRATION=false
      RUN_E2E=false
      shift
      ;;
    --integration)
      RUN_UNIT=false
      RUN_INTEGRATION=true
      RUN_E2E=false
      shift
      ;;
    --e2e)
      RUN_UNIT=false
      RUN_INTEGRATION=false
      RUN_E2E=true
      shift
      ;;
    --quick)
      QUICK_MODE=true
      RUN_INTEGRATION=false
      RUN_E2E=false
      shift
      ;;
    --coverage)
      COVERAGE_ENABLED=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--unit|--integration|--e2e|--quick]"
      echo ""
      echo "Options:"
      echo "  --unit        Run unit tests only (no credentials needed)"
      echo "  --integration Run integration tests (needs USEAPI_* env vars)"
      echo "  --e2e         Run E2E shell tests (needs credentials)"
      echo "  --quick       Quick unit tests only"
      echo "  --coverage    Enable coverage reporting"
      echo "  --help        Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Create output directory with timestamp
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_DIR="$SCRIPT_DIR/output/$TIMESTAMP"
mkdir -p "$OUTPUT_DIR"/{unit,integration,e2e}

# Update latest symlink
rm -f "$SCRIPT_DIR/output/latest"
ln -sf "$TIMESTAMP" "$SCRIPT_DIR/output/latest"

# Initialize summary
SUMMARY_JSON="$OUTPUT_DIR/summary.json"
SUMMARY_MD="$OUTPUT_DIR/summary.md"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo "=============================================="
echo "  veo-cli Test Suite"
echo "  $(date)"
echo "=============================================="
echo ""
echo "Output directory: $OUTPUT_DIR"
echo ""

# Initialize counters
UNIT_PASSED=0
UNIT_FAILED=0
UNIT_SKIPPED=0
INTEGRATION_PASSED=0
INTEGRATION_FAILED=0
INTEGRATION_SKIPPED=0
E2E_PASSED=0
E2E_FAILED=0
E2E_SKIPPED=0

# Check environment
HAS_USEAPI_CREDS=false
HAS_COOKIE=false

if [[ -n "${USEAPI_API_TOKEN:-}" ]] && [[ -n "${USEAPI_ACCOUNT_EMAIL:-}" ]]; then
  HAS_USEAPI_CREDS=true
  log_info "useapi.net credentials: CONFIGURED"
else
  log_warn "useapi.net credentials: NOT SET (set USEAPI_API_TOKEN and USEAPI_ACCOUNT_EMAIL)"
fi

if [[ -f "cookie.json" ]]; then
  HAS_COOKIE=true
  log_info "Direct backend (cookie.json): FOUND"
else
  log_warn "Direct backend (cookie.json): NOT FOUND"
fi

echo ""

# ============================================================================
# UNIT TESTS
# ============================================================================

if [[ "$RUN_UNIT" == "true" ]]; then
  log_info "Running unit tests..."

  UNIT_OUTPUT="$OUTPUT_DIR/unit/output.log"
  UNIT_RESULTS="$OUTPUT_DIR/unit/results.json"

  # Build coverage flag
  COVERAGE_FLAG=""
  if [[ "$COVERAGE_ENABLED" == "true" ]]; then
    COVERAGE_FLAG="--coverage"
    log_info "Coverage reporting enabled"
  fi

  # Run bun test and capture output
  set +e
  if [[ "$QUICK_MODE" == "true" ]]; then
    bun test $COVERAGE_FLAG tests/useapi-extended.test.ts tests/useapi.test.ts 2>&1 | tee "$UNIT_OUTPUT"
  else
    bun test $COVERAGE_FLAG 2>&1 | tee "$UNIT_OUTPUT"
  fi
  UNIT_EXIT_CODE=$?
  set -e

  # Parse results from output
  if grep -q "fail" "$UNIT_OUTPUT"; then
    UNIT_FAILED=$(grep -oE '[0-9]+ fail' "$UNIT_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
  fi
  if grep -q "pass" "$UNIT_OUTPUT"; then
    UNIT_PASSED=$(grep -oE '[0-9]+ pass' "$UNIT_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
  fi
  if grep -q "skip" "$UNIT_OUTPUT"; then
    UNIT_SKIPPED=$(grep -oE '[0-9]+ skip' "$UNIT_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
  fi

  # Create results JSON
  cat > "$UNIT_RESULTS" << EOF
{
  "category": "unit",
  "timestamp": "$TIMESTAMP",
  "passed": $UNIT_PASSED,
  "failed": $UNIT_FAILED,
  "skipped": $UNIT_SKIPPED,
  "exit_code": $UNIT_EXIT_CODE,
  "output_file": "output.log"
}
EOF

  if [[ $UNIT_EXIT_CODE -eq 0 ]]; then
    log_success "Unit tests: $UNIT_PASSED passed, $UNIT_SKIPPED skipped"
  else
    log_fail "Unit tests: $UNIT_PASSED passed, $UNIT_FAILED failed"
  fi

  echo ""
fi

# ============================================================================
# INTEGRATION TESTS (requires credentials)
# ============================================================================

if [[ "$RUN_INTEGRATION" == "true" ]]; then
  log_info "Running integration tests..."

  INTEGRATION_OUTPUT="$OUTPUT_DIR/integration/output.log"
  INTEGRATION_RESULTS="$OUTPUT_DIR/integration/results.json"

  if [[ "$HAS_USEAPI_CREDS" == "true" ]]; then
    set +e
    bun test tests/useapi-extended.e2e.test.ts tests/cli.e2e.test.ts 2>&1 | tee "$INTEGRATION_OUTPUT"
    INTEGRATION_EXIT_CODE=$?
    set -e

    # Parse results
    if grep -q "pass" "$INTEGRATION_OUTPUT"; then
      INTEGRATION_PASSED=$(grep -oE '[0-9]+ pass' "$INTEGRATION_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
    fi
    if grep -q "fail" "$INTEGRATION_OUTPUT"; then
      INTEGRATION_FAILED=$(grep -oE '[0-9]+ fail' "$INTEGRATION_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
    fi
    if grep -q "skip" "$INTEGRATION_OUTPUT"; then
      INTEGRATION_SKIPPED=$(grep -oE '[0-9]+ skip' "$INTEGRATION_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
    fi
  else
    echo "Skipped: No useapi.net credentials configured" | tee "$INTEGRATION_OUTPUT"
    INTEGRATION_EXIT_CODE=0
    INTEGRATION_SKIPPED=1
  fi

  cat > "$INTEGRATION_RESULTS" << EOF
{
  "category": "integration",
  "timestamp": "$TIMESTAMP",
  "passed": $INTEGRATION_PASSED,
  "failed": $INTEGRATION_FAILED,
  "skipped": $INTEGRATION_SKIPPED,
  "credentials_available": $HAS_USEAPI_CREDS,
  "exit_code": ${INTEGRATION_EXIT_CODE:-0},
  "output_file": "output.log"
}
EOF

  if [[ "$HAS_USEAPI_CREDS" == "true" ]]; then
    if [[ $INTEGRATION_EXIT_CODE -eq 0 ]]; then
      log_success "Integration tests: $INTEGRATION_PASSED passed, $INTEGRATION_SKIPPED skipped"
    else
      log_fail "Integration tests: $INTEGRATION_PASSED passed, $INTEGRATION_FAILED failed"
    fi
  else
    log_warn "Integration tests: SKIPPED (no credentials)"
  fi

  echo ""
fi

# ============================================================================
# E2E SHELL TESTS
# ============================================================================

if [[ "$RUN_E2E" == "true" ]]; then
  log_info "Running E2E shell tests..."

  E2E_OUTPUT="$OUTPUT_DIR/e2e/output.log"
  E2E_RESULTS="$OUTPUT_DIR/e2e/results.json"

  if [[ "$HAS_USEAPI_CREDS" == "true" ]] || [[ "$HAS_COOKIE" == "true" ]]; then
    # Determine which backend to use
    BACKEND="useapi"
    if [[ "$HAS_USEAPI_CREDS" != "true" ]] && [[ "$HAS_COOKIE" == "true" ]]; then
      BACKEND="direct"
    fi

    set +e
    ./tests/test-comprehensive.sh "$BACKEND" --dry-run 2>&1 | tee "$E2E_OUTPUT"
    E2E_EXIT_CODE=$?
    set -e

    # Parse results from comprehensive test output
    if grep -q "Passed:" "$E2E_OUTPUT"; then
      E2E_PASSED=$(grep -oE 'Passed:\s+[0-9]+' "$E2E_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
    fi
    if grep -q "Failed:" "$E2E_OUTPUT"; then
      E2E_FAILED=$(grep -oE 'Failed:\s+[0-9]+' "$E2E_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
    fi
    if grep -q "Skipped:" "$E2E_OUTPUT"; then
      E2E_SKIPPED=$(grep -oE 'Skipped:\s+[0-9]+' "$E2E_OUTPUT" | head -1 | grep -oE '[0-9]+' || echo "0")
    fi
  else
    echo "Skipped: No credentials configured" | tee "$E2E_OUTPUT"
    E2E_EXIT_CODE=0
    E2E_SKIPPED=1
  fi

  cat > "$E2E_RESULTS" << EOF
{
  "category": "e2e",
  "timestamp": "$TIMESTAMP",
  "passed": $E2E_PASSED,
  "failed": $E2E_FAILED,
  "skipped": $E2E_SKIPPED,
  "backend": "${BACKEND:-none}",
  "dry_run": true,
  "exit_code": ${E2E_EXIT_CODE:-0},
  "output_file": "output.log"
}
EOF

  if [[ "$HAS_USEAPI_CREDS" == "true" ]] || [[ "$HAS_COOKIE" == "true" ]]; then
    if [[ $E2E_EXIT_CODE -eq 0 ]]; then
      log_success "E2E tests (dry-run): $E2E_PASSED passed, $E2E_SKIPPED skipped"
    else
      log_fail "E2E tests: $E2E_PASSED passed, $E2E_FAILED failed"
    fi
  else
    log_warn "E2E tests: SKIPPED (no credentials)"
  fi

  echo ""
fi

# ============================================================================
# GENERATE SUMMARY
# ============================================================================

TOTAL_PASSED=$((UNIT_PASSED + INTEGRATION_PASSED + E2E_PASSED))
TOTAL_FAILED=$((UNIT_FAILED + INTEGRATION_FAILED + E2E_FAILED))
TOTAL_SKIPPED=$((UNIT_SKIPPED + INTEGRATION_SKIPPED + E2E_SKIPPED))
TOTAL_TESTS=$((TOTAL_PASSED + TOTAL_FAILED + TOTAL_SKIPPED))

# Create summary JSON
cat > "$SUMMARY_JSON" << EOF
{
  "timestamp": "$TIMESTAMP",
  "output_directory": "$OUTPUT_DIR",
  "environment": {
    "useapi_credentials": $HAS_USEAPI_CREDS,
    "cookie_json": $HAS_COOKIE,
    "platform": "$(uname -s)",
    "bun_version": "$(bun --version)"
  },
  "totals": {
    "passed": $TOTAL_PASSED,
    "failed": $TOTAL_FAILED,
    "skipped": $TOTAL_SKIPPED,
    "total": $TOTAL_TESTS
  },
  "categories": {
    "unit": {
      "passed": $UNIT_PASSED,
      "failed": $UNIT_FAILED,
      "skipped": $UNIT_SKIPPED,
      "ran": $RUN_UNIT
    },
    "integration": {
      "passed": $INTEGRATION_PASSED,
      "failed": $INTEGRATION_FAILED,
      "skipped": $INTEGRATION_SKIPPED,
      "ran": $RUN_INTEGRATION
    },
    "e2e": {
      "passed": $E2E_PASSED,
      "failed": $E2E_FAILED,
      "skipped": $E2E_SKIPPED,
      "ran": $RUN_E2E
    }
  }
}
EOF

# Create summary Markdown
cat > "$SUMMARY_MD" << EOF
# Test Run Summary

**Date:** $(date)
**Timestamp:** $TIMESTAMP
**Output:** \`tests/output/$TIMESTAMP/\`

## Environment

| Setting | Value |
|---------|-------|
| Platform | $(uname -s) |
| Bun Version | $(bun --version) |
| useapi.net Credentials | $([ "$HAS_USEAPI_CREDS" = true ] && echo "Configured" || echo "Not Set") |
| cookie.json | $([ "$HAS_COOKIE" = true ] && echo "Found" || echo "Not Found") |

## Results Summary

| Category | Passed | Failed | Skipped | Total |
|----------|--------|--------|---------|-------|
| Unit Tests | $UNIT_PASSED | $UNIT_FAILED | $UNIT_SKIPPED | $((UNIT_PASSED + UNIT_FAILED + UNIT_SKIPPED)) |
| Integration | $INTEGRATION_PASSED | $INTEGRATION_FAILED | $INTEGRATION_SKIPPED | $((INTEGRATION_PASSED + INTEGRATION_FAILED + INTEGRATION_SKIPPED)) |
| E2E (Shell) | $E2E_PASSED | $E2E_FAILED | $E2E_SKIPPED | $((E2E_PASSED + E2E_FAILED + E2E_SKIPPED)) |
| **TOTAL** | **$TOTAL_PASSED** | **$TOTAL_FAILED** | **$TOTAL_SKIPPED** | **$TOTAL_TESTS** |

## Status

$(if [[ $TOTAL_FAILED -eq 0 ]]; then echo "**ALL TESTS PASSED**"; else echo "**SOME TESTS FAILED**"; fi)

## Output Files

\`\`\`
$OUTPUT_DIR/
├── summary.json          # Machine-readable summary
├── summary.md            # This file
├── unit/
│   ├── output.log        # Full unit test output
│   └── results.json      # Parsed results
├── integration/
│   ├── output.log        # Integration test output
│   └── results.json      # Parsed results
└── e2e/
    ├── output.log        # E2E test output
    └── results.json      # Parsed results
\`\`\`

## Test Files

### Unit Tests (\`bun test\`)
$(ls -1 tests/*.test.ts 2>/dev/null | sed 's/^/- /' || echo "- (none found)")

### Shell Tests
$(ls -1 tests/test-*.sh 2>/dev/null | sed 's/^/- /' || echo "- (none found)")

---
Generated by \`run-all-tests.sh\`
EOF

# ============================================================================
# FINAL OUTPUT
# ============================================================================

echo ""
echo "=============================================="
echo "  Test Run Complete"
echo "=============================================="
echo ""
echo "Results:"
echo "  Passed:  $TOTAL_PASSED"
echo "  Failed:  $TOTAL_FAILED"
echo "  Skipped: $TOTAL_SKIPPED"
echo "  Total:   $TOTAL_TESTS"
echo ""
echo "Output directory: $OUTPUT_DIR"
echo "Summary: $SUMMARY_MD"
echo ""

# Show tree if available
if command -v tree &> /dev/null; then
  tree "$OUTPUT_DIR" -L 2
else
  ls -la "$OUTPUT_DIR"
fi

echo ""

# Exit with failure if any tests failed
if [[ $TOTAL_FAILED -gt 0 ]]; then
  log_fail "Some tests failed. Check output logs for details."
  exit 1
else
  log_success "All tests passed!"
  exit 0
fi
