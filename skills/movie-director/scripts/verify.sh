#!/usr/bin/env bash
# verify.sh — run BEFORE any movie-director project to confirm environment is sane.
# Pings each external service, checks env vars, reports status.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEOCLAW_ROOT="${VIDEOCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
CLI_BIN="${VIDEOCLAW_ROOT}/dist/cli/vclaw.js"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Movie Director Environment Check ==="
echo ""

# ---------- Load .env ----------
if [ -f "$VIDEOCLAW_ROOT/.env" ]; then
  set -a
  source "$VIDEOCLAW_ROOT/.env"
  set +a
  echo -e "${GREEN}✓${NC} Loaded $VIDEOCLAW_ROOT/.env"
else
  echo -e "${RED}✗${NC} No .env at $VIDEOCLAW_ROOT/.env"
  exit 1
fi
echo ""

# ---------- Env var presence ----------
check_env() {
  local name=$1
  local val="${!name-}"
  if [ -n "$val" ]; then
    echo -e "${GREEN}✓${NC} $name is set (${val:0:10}...)"
    return 0
  else
    echo -e "${RED}✗${NC} $name is MISSING"
    return 1
  fi
}

check_env_optional() {
  local name=$1
  local val="${!name-}"
  if [ -n "$val" ]; then
    echo -e "${GREEN}✓${NC} $name is set (optional)"
    return 0
  else
    echo -e "${YELLOW}⚠${NC} $name is not set (optional — feature disabled)"
    return 0
  fi
}

echo "--- Environment variables ---"
MISSING=0
check_env GOOGLE_API_KEY || MISSING=$((MISSING+1))
check_env GO_BANANAS_API_KEY || MISSING=$((MISSING+1))
check_env SUTUI_API_KEY || MISSING=$((MISSING+1))
check_env_optional GEMINI_API_KEYS
check_env_optional ELEVENLABS_API_KEY
check_env_optional KIE_API_KEY

# Pool size from GEMINI_API_KEYS
if [ -n "${GEMINI_API_KEYS-}" ]; then
  # Count keys (comma-separated)
  POOL_SIZE=$(echo "${GEMINI_API_KEYS}" | tr ',;' '\n' | grep -c .)
  if [ "$POOL_SIZE" -gt 2 ]; then
    echo -e "${GREEN}✓${NC} Gemini key pool size: $POOL_SIZE (good — rotates on 429)"
  elif [ "$POOL_SIZE" -gt 0 ]; then
    echo -e "${YELLOW}⚠${NC} Gemini key pool size: $POOL_SIZE (recommend 3+ for 14-scene runs)"
  fi
fi
echo ""

if [ "$MISSING" -gt 0 ]; then
  echo -e "${RED}✗ $MISSING required env vars missing. Cannot proceed.${NC}"
  exit 2
fi

# ---------- Live API pings ----------
echo "--- API reachability ---"

# Gemini
GEMINI_TEST_KEY="${GEMINI_API_KEYS%%,*}"  # first key from pool, or falls back to GOOGLE_API_KEY
GEMINI_TEST_KEY="${GEMINI_TEST_KEY:-$GOOGLE_API_KEY}"
if [ -n "$GEMINI_TEST_KEY" ]; then
  RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -H "X-goog-api-key: $GEMINI_TEST_KEY" \
    -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \
    -d '{"contents":[{"parts":[{"text":"OK"}]}],"generationConfig":{"maxOutputTokens":5}}')
  case "$RESP" in
    200) echo -e "${GREEN}✓${NC} Gemini (gemini-flash-latest) reachable — HTTP 200" ;;
    429) echo -e "${YELLOW}⚠${NC} Gemini HTTP 429 — key rate-limited (will recover with pool)" ;;
    401|403) echo -e "${RED}✗${NC} Gemini HTTP $RESP — key invalid or no project access" ;;
    *) echo -e "${RED}✗${NC} Gemini HTTP $RESP — unexpected" ;;
  esac
fi

# Go Bananas
GB_BASE="${GO_BANANAS_API_URL:-https://gobananasai.com/api}"
RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-API-Key: $GO_BANANAS_API_KEY" \
  -H "Accept: application/json" \
  "$GB_BASE/characters?offset=0")
case "$RESP" in
  200) echo -e "${GREEN}✓${NC} Go Bananas reachable — HTTP 200" ;;
  401|403) echo -e "${RED}✗${NC} Go Bananas HTTP $RESP — key invalid" ;;
  *) echo -e "${RED}✗${NC} Go Bananas HTTP $RESP — unexpected" ;;
esac

# SUTUI (Asset Library — best-effort, no public endpoint check)
if [ -n "${SUTUI_API_KEY-}" ]; then
  echo -e "${GREEN}✓${NC} SUTUI_API_KEY present (Asset Library — no ping endpoint; live check at first upload)"
fi

# ElevenLabs (voices list is the standard ping)
if [ -n "${ELEVENLABS_API_KEY-}" ]; then
  RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    "https://api.elevenlabs.io/v1/voices")
  case "$RESP" in
    200) echo -e "${GREEN}✓${NC} ElevenLabs reachable — HTTP 200" ;;
    401|403) echo -e "${YELLOW}⚠${NC} ElevenLabs HTTP $RESP — key invalid (narration will be skipped)" ;;
    *) echo -e "${YELLOW}⚠${NC} ElevenLabs HTTP $RESP" ;;
  esac
fi
echo ""

# ---------- Binaries ----------
echo "--- Local dependencies ---"
for cmd in ffmpeg ffprobe node npm python3 curl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $cmd found ($(command -v "$cmd"))"
  else
    echo -e "${RED}✗${NC} $cmd NOT FOUND — install before proceeding"
    MISSING=$((MISSING+1))
  fi
done
echo ""

# ---------- Build state ----------
echo "--- Build state ---"
if [ -f "$CLI_BIN" ]; then
  BUILD_AGE=$(stat -f "%m" "$CLI_BIN" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  AGE_HOURS=$(( (NOW - BUILD_AGE) / 3600 ))
  if [ "$AGE_HOURS" -lt 24 ]; then
    echo -e "${GREEN}✓${NC} clean-room CLI built ${AGE_HOURS}h ago (fresh)"
  else
    echo -e "${YELLOW}⚠${NC} dist/ is ${AGE_HOURS}h old — run 'npm run build' if code has changed"
  fi
else
  echo -e "${RED}✗${NC} dist/cli/vclaw.js missing — run 'npm run build'"
  MISSING=$((MISSING+1))
fi

echo ""
echo "--- Native verify-env ---"
if node "$CLI_BIN" video verify-env --root "$VIDEOCLAW_ROOT" >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} vclaw video verify-env completed"
else
  echo -e "${YELLOW}⚠${NC} vclaw video verify-env reported issues — inspect with:"
  echo "  node \"$CLI_BIN\" video verify-env --root \"$VIDEOCLAW_ROOT\""
fi

echo ""
if [ "$MISSING" -eq 0 ]; then
  echo -e "${GREEN}=== ALL CHECKS PASSED — ready to run movie-director ===${NC}"
  exit 0
else
  echo -e "${RED}=== $MISSING check(s) failed — resolve before running ===${NC}"
  exit 1
fi
