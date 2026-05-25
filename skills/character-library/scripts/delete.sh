#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash skills/character-library/scripts/delete.sh <id> [<id> ...] [--yes]" >&2
  exit 1
fi

CONFIRM=0
IDS=()
for arg in "$@"; do
  if [[ "$arg" == "--yes" ]]; then
    CONFIRM=1
  else
    IDS+=("$arg")
  fi
done

if [[ ${#IDS[@]} -eq 0 ]]; then
  echo "no ids supplied" >&2
  exit 1
fi

if [[ "$CONFIRM" -ne 1 ]]; then
  echo "dry-run delete preview:"
  printf '  %s\n' "${IDS[@]}"
  echo "rerun with --yes to delete"
  exit 0
fi

python3 - "${IDS[@]}" <<'PY'
import os
import sys
import urllib.request

ids = sys.argv[1:]
api_key = os.getenv("GO_BANANAS_API_KEY")
if not api_key:
    raise SystemExit("GO_BANANAS_API_KEY is required")

api_base = os.getenv("GO_BANANAS_API_BASE", "https://api.go-bananas.com").rstrip("/")
for character_id in ids:
    request = urllib.request.Request(
        f"{api_base}/characters/{character_id}",
        method="DELETE",
        headers={"x-api-key": api_key, "accept": "application/json"},
    )
    with urllib.request.urlopen(request):
        pass
    print(f"deleted id={character_id}")
PY
