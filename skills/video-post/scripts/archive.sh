#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash skills/video-post/scripts/archive.sh <project-dir> [archive-dir] [--cleanup]" >&2
  exit 1
fi

PROJECT_DIR="${1%/}"
ARCHIVE_DIR="${2:-${PROJECT_DIR%/*}/archives}"
CLEANUP=0

for arg in "$@"; do
  if [[ "$arg" == "--cleanup" ]]; then
    CLEANUP=1
  fi
done

mkdir -p "$ARCHIVE_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="$(basename "$PROJECT_DIR")"
ARCHIVE_PATH="$ARCHIVE_DIR/${NAME}-${STAMP}.tar.gz"

tar -czf "$ARCHIVE_PATH" -C "$(dirname "$PROJECT_DIR")" "$NAME"
echo "archive=$ARCHIVE_PATH"

if [[ "$CLEANUP" -eq 1 ]]; then
  rm -rf "$PROJECT_DIR"
  echo "cleanup=done"
fi
