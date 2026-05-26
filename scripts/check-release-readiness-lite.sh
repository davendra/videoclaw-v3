#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

check_ignored() {
  local path="$1"
  if ! git check-ignore -q -- "$path"; then
    echo "generated verification artifact path is not ignored: $path" >&2
    exit 1
  fi
}

check_ignored "outputs/smoke-result.json"
check_ignored ".playwright-mcp/session.json"
check_ignored "vclaw-review-ui-desktop-after-stage-gate.png"
check_ignored "vclaw-review-ui-mobile-after-stage-gate.png"
check_ignored "projects/example/outputs/final.mp4"
echo "generated verification artifact ignore check passed"

npm run build
npm run test:node
node scripts/smoke-runtime.mjs
node scripts/smoke-native-veo.mjs
node scripts/smoke-character-hydration.mjs
node scripts/smoke-execution-cancel.mjs
node scripts/smoke-portfolio.mjs
node scripts/smoke-reference-sheets.mjs
node scripts/smoke-scene-candidates.mjs
node scripts/smoke-assemble.mjs
node scripts/e2e-image-storyboard-workflow.mjs --verify-server
bash scripts/check-movie-director-wrappers.sh
bash scripts/check-cleanroom-docs.sh
bash scripts/check-skill-frontdoor.sh
node scripts/check-artifact-schema-coverage.mjs

echo "release-readiness-lite checks passed"
