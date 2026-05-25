#!/usr/bin/env bash
# check-artifact-schema-coverage.sh
#
# Asserts that the set of canonical artifacts WRITTEN by `src/video/**/*.ts`
# matches the set of canonical artifacts DESCRIBED by JSON schemas in
# `schemas/video/artifacts/`. Drift in either direction fails.
#
# Per MERGE_PLAN.md Addendum B6. Run from release-readiness-lite.
#
# Uses Node for the writer extraction because the writeArtifact() pattern
# is best parsed by a real regex engine, not shell quoting.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec node scripts/check-artifact-schema-coverage.mjs
