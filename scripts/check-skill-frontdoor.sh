#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

targets=()
while IFS= read -r skill_path; do
  targets+=("$skill_path")
done < <(find skills -mindepth 2 -maxdepth 2 -name SKILL.md | sort)

ignore_paths=(
  "skills/seedance-prompts/SKILL.md"
  # movie-director references the legacy script paths in its
  # references/ subdir; those docs are historical-reference-style.
  # The SKILL.md itself uses the vclaw CLI surface.
)

patterns=(
  "node dist/cli/omx\\.js"
  "python3? scripts/"
  "python3? skills/video-replicator/scripts/"
  "auto_create_characters\\.py"
  "find_library_characters\\.py"
  "generate_gobananas\\.py"
  "campaign_manifest\\.py"
  "ugc_strategy\\.py"
  "ugc_scripts\\.py"
  "parallel_video_gen\\.py"
  "generate_tts\\.py"
  "stitch_video\\.py"
  "film_pipeline\\.py"
  "seedance_prompt_db\\.py"
  "seed_skill_prompts\\.py"
)

matches=0

for pattern in "${patterns[@]}"; do
  while IFS=: read -r file line content; do
    [ -n "${file:-}" ] || continue
    skip=false
    for ignored in "${ignore_paths[@]}"; do
      if [[ "$file" == "$ignored" ]]; then
        skip=true
        break
      fi
    done
    if [ "$skip" = true ]; then
      continue
    fi
    echo "stale skill front-door reference: $file:$line:$content"
    matches=$((matches + 1))
  done < <(rg -n "$pattern" "${targets[@]}" || true)
done

if [ "$matches" -gt 0 ]; then
  echo "found $matches stale skill front-door reference(s)"
  exit 1
fi

echo "skill front-door docs passed stale-reference scan"
