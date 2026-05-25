#!/usr/bin/env bash
# list-library.sh — browse your Go Bananas character library.
# Useful before starting a project to know which characters you already have.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
CLI_BIN="${VIDEOCLAW_ROOT}/dist/cli/vclaw.js"

# Load .env
if [ -f "$VIDEOCLAW_ROOT/.env" ]; then
  set -a; source "$VIDEOCLAW_ROOT/.env"; set +a
fi

if [ -z "$GO_BANANAS_API_KEY" ]; then
  echo "GO_BANANAS_API_KEY not set. Check .env"
  exit 1
fi

CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Go Bananas Character Library ===${NC}"
echo ""

# Filter by name-regex if passed
FILTER="${1:-}"
if [ -n "$FILTER" ]; then
  "$CLI_BIN" video library clean --name-regex "$FILTER" --dry-run
else
  # List all characters — use a broad regex to catch everything
  "$CLI_BIN" video library clean --name-regex "." --dry-run
fi

echo ""
echo "Usage in a project command:"
echo "  --gb-character \"Name:ID\""
echo ""
echo "Create new character:"
echo "  echo '[{\"name\":\"...\",\"description\":\"...\",\"style\":\"...\"}]' > /tmp/c.json"
echo "  node \"$CLI_BIN\" video character-auto-create --project <slug> --input /tmp/c.json"
