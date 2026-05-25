#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: bash skills/character-library/scripts/patch.sh <id> <new-base-prompt>" >&2
  exit 1
fi

CHARACTER_ID="$1"
shift
BASE_PROMPT="$*"

python3 - "$CHARACTER_ID" "$BASE_PROMPT" <<'PY'
import json
import os
import sys
import urllib.request

character_id = sys.argv[1]
base_prompt = sys.argv[2]
api_key = os.getenv("GO_BANANAS_API_KEY")
if not api_key:
    raise SystemExit("GO_BANANAS_API_KEY is required")

api_base = os.getenv("GO_BANANAS_API_BASE", "https://api.go-bananas.com").rstrip("/")
payload = json.dumps({"base_prompt": base_prompt}).encode("utf-8")
request = urllib.request.Request(
    f"{api_base}/characters/{character_id}",
    data=payload,
    method="PATCH",
    headers={
        "x-api-key": api_key,
        "content-type": "application/json",
        "accept": "application/json",
    },
)

with urllib.request.urlopen(request) as response:
    body = json.load(response)

character = body.get("data") if isinstance(body, dict) and "data" in body else body
name = character.get("character_name") or character.get("name") or character_id
print(f"patched id={character_id} | name={name} | prompt={len(base_prompt)}ch")
PY
