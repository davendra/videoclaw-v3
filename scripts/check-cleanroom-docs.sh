#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

targets=(
  "README.md"
  "docs"
  "skills/movie-director"
  "skills/seedance-prompts"
)

ignore_paths=(
  "docs/RELEASE_READINESS.md"
  "skills/seedance-prompts/SKILL.md"
  # Workflow / process docs (specs, plans, audits, research) legitimately
  # reference files that don't exist yet (TDD steps) and absolute paths
  # for executing agents. Out of scope for the clean-room CLI docs
  # guardrail. Trailing slash = directory-prefix ignore.
  "docs/superpowers/"
)

patterns=(
  "/Users/davendrapatel"
  "auto_create_characters\\.py"
  "python3 scripts/video/"
  "bin/omx\\.js"
  "GO_BANANAS_GENERATION_TRANSPORT=mcp.*vclaw video create"
  "node dist/cli/omx\\.js video create"
  "seedance_prompt_db\\.py expand"
  "seed_skill_prompts\\.py"
  "Cannot find module"
  "MODULE_NOT_FOUND"
)

matches=0

for pattern in "${patterns[@]}"; do
  while IFS=: read -r file line content; do
    [ -n "${file:-}" ] || continue
    skip=false
    for ignored in "${ignore_paths[@]}"; do
      # Trailing-slash entries are directory-prefix ignores; everything
      # else still requires exact path match.
      if [[ "$ignored" == */ ]]; then
        if [[ "$file" == "$ignored"* ]]; then
          skip=true
          break
        fi
      elif [[ "$file" == "$ignored" ]]; then
        skip=true
        break
      fi
    done
    if [ "$skip" = true ]; then
      continue
    fi
    echo "stale reference: $file:$line:$content"
    matches=$((matches + 1))
  done < <(rg -n "$pattern" "${targets[@]}" || true)
done

if [ "$matches" -gt 0 ]; then
  echo "found $matches stale clean-room-facing reference(s)"
  exit 1
fi

echo "clean-room-facing docs and skills passed stale-reference scan"
