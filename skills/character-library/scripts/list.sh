#!/usr/bin/env bash
set -euo pipefail

PATTERN="${1-}"

python3 - "$PATTERN" <<'PY'
import json
import os
import re
import sys
import urllib.request

api_key = os.getenv("GO_BANANAS_API_KEY")
if not api_key:
    raise SystemExit("GO_BANANAS_API_KEY is required")

api_base = os.getenv("GO_BANANAS_API_BASE", "https://api.go-bananas.com").rstrip("/")
pattern = sys.argv[1]
regex = re.compile(pattern, re.I) if pattern else None

items = []
offset = 0
page_size = 100

while True:
    request = urllib.request.Request(
        f"{api_base}/characters?offset={offset}",
        headers={"x-api-key": api_key, "accept": "application/json"},
    )
    with urllib.request.urlopen(request) as response:
        payload = json.load(response)
    batch = payload.get("data") or payload.get("characters") or []
    if not isinstance(batch, list):
        raise SystemExit("Unexpected Go Bananas response shape for /characters")
    items.extend(batch)
    if len(batch) < page_size:
        break
    offset += len(batch)

print("CHARACTER LIBRARY")
print("=================")
for item in items:
    name = str(item.get("character_name") or item.get("name") or "?")
    if regex and not regex.search(name):
        continue
    prompt = " ".join(str(item.get("base_prompt") or "").split())
    refs = item.get("reference_images") or []
    preview = f"{prompt[:90]}{'...' if len(prompt) > 90 else ''}"
    print(
        f"id={item.get('id')} | name={name} | refs={len(refs)} | "
        f"prompt={len(prompt)}ch | {preview}"
    )
PY
