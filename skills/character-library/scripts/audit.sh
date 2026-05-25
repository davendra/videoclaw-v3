#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import json
import os
import re
import urllib.request

api_key = os.getenv("GO_BANANAS_API_KEY")
if not api_key:
    raise SystemExit("GO_BANANAS_API_KEY is required")

api_base = os.getenv("GO_BANANAS_API_BASE", "https://api.go-bananas.com").rstrip("/")
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

style_pattern = re.compile(
    r"(cinematic|photorealistic|anime|illustration|render|pixar|noir|storybook|stylized)",
    re.I,
)
animal_words = re.compile(r"(rabbit|dog|cat|fox|wolf|bear|bird|animal)", re.I)
human_words = re.compile(r"\b(human|woman|man|girl|boy|person)\b", re.I)
robot_words = re.compile(r"(robot|android|mechanical|drone|cyborg)", re.I)

issues = []
for item in items:
    name = str(item.get("character_name") or item.get("name") or "?")
    prompt = " ".join(str(item.get("base_prompt") or "").split())
    refs = item.get("reference_images") or []
    reasons = []
    if len(prompt) < 80:
        reasons.append("vague-prompt")
    if len(prompt) > 400:
        reasons.append("bloated-prompt")
    if len(refs) == 0:
        reasons.append("missing-reference-images")
    if not style_pattern.search(prompt):
        reasons.append("missing-style-language")
    if animal_words.search(name) and human_words.search(prompt):
        reasons.append("animal-name-human-prompt")
    if animal_words.search(prompt) and robot_words.search(prompt):
        reasons.append("animal-mechanical-conflict")
    if reasons:
        issues.append((name, item.get("id"), reasons, len(prompt)))

print("CHARACTER LIBRARY AUDIT")
print("=======================")
print(f"scanned={len(items)}")
print(f"flagged={len(issues)}")
for name, item_id, reasons, prompt_len in issues:
    joined = ", ".join(reasons)
    print(f"- id={item_id} | name={name} | prompt={prompt_len}ch | issues={joined}")
PY
