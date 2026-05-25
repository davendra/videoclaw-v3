#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$ROOT_DIR/skills/movie-director/scripts/auto.sh"
bash -n "$ROOT_DIR/skills/movie-director/scripts/iterate.sh"
bash -n "$ROOT_DIR/skills/movie-director/scripts/run-pipeline.sh"
bash -n "$ROOT_DIR/skills/movie-director/scripts/verify.sh"
bash -n "$ROOT_DIR/skills/movie-director/scripts/list-library.sh"
bash -n "$ROOT_DIR/skills/movie-director/scripts/interview.sh"

echo "movie-director wrapper syntax checks passed"
