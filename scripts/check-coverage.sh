#!/usr/bin/env bash
# check-coverage.sh
#
# Runs frontend (Vitest) and backend (Go) tests with coverage.
# Fails if coverage for either drops below the stored baseline.
# Updates the baseline when coverage holds or improves.
#
# Baseline files are committed to the repo so all developers share the floor.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_BASELINE="$REPO_ROOT/.frontend-coverage-baseline"
BACKEND_BASELINE="$REPO_ROOT/.backend-coverage-baseline"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_pass() { echo -e "${GREEN}✓${NC} $1"; }
check_fail() { echo -e "${RED}✗${NC} $1"; }
check_info() { echo -e "${YELLOW}→${NC} $1"; }

# ── helper: compare two floats ───────────────────────────────────────────────
# Returns 0 (true) if $1 < $2
float_lt() {
  python3 -c "import sys; sys.exit(0 if float('$1') < float('$2') else 1)"
}

FAILED=0

# ── FRONTEND ─────────────────────────────────────────────────────────────────
check_info "Running frontend tests with coverage…"

cd "$REPO_ROOT/frontend"
npm run test:coverage > /dev/null 2>&1 || {
  check_fail "Frontend tests failed — fix failing tests before committing."
  FAILED=1
}

# Parse line coverage % from the JSON summary Vitest writes
FRONTEND_PCT=$(node -e "
  const s = require('./coverage/coverage-summary.json');
  process.stdout.write(String(s.total.lines.pct));
" 2>/dev/null || echo "0")

if [ -f "$FRONTEND_BASELINE" ]; then
  BASELINE=$(cat "$FRONTEND_BASELINE")
  if float_lt "$FRONTEND_PCT" "$BASELINE"; then
    check_fail "Frontend coverage dropped: ${BASELINE}% → ${FRONTEND_PCT}% (must not decrease)"
    FAILED=1
  else
    check_pass "Frontend coverage: ${FRONTEND_PCT}% (baseline: ${BASELINE}%)"
    # Update baseline if coverage improved
    echo "$FRONTEND_PCT" > "$FRONTEND_BASELINE"
  fi
else
  check_info "No frontend baseline found — creating at ${FRONTEND_PCT}%"
  echo "$FRONTEND_PCT" > "$FRONTEND_BASELINE"
fi

# ── BACKEND ──────────────────────────────────────────────────────────────────
check_info "Running backend tests with coverage…"

cd "$REPO_ROOT/backend"
go test ./... -coverprofile=coverage.out -covermode=atomic -count=1 > /dev/null 2>&1 || {
  check_fail "Backend tests failed — fix failing tests before committing."
  FAILED=1
}

BACKEND_PCT=$(go tool cover -func=coverage.out 2>/dev/null \
  | grep '^total:' \
  | awk '{gsub(/%/, "", $3); print $3}')
BACKEND_PCT="${BACKEND_PCT:-0}"

# Clean up temp coverage file
rm -f coverage.out

if [ -f "$BACKEND_BASELINE" ]; then
  BASELINE=$(cat "$BACKEND_BASELINE")
  if float_lt "$BACKEND_PCT" "$BASELINE"; then
    check_fail "Backend coverage dropped: ${BASELINE}% → ${BACKEND_PCT}% (must not decrease)"
    FAILED=1
  else
    check_pass "Backend coverage: ${BACKEND_PCT}% (baseline: ${BASELINE}%)"
    echo "$BACKEND_PCT" > "$BACKEND_BASELINE"
  fi
else
  check_info "No backend baseline found — creating at ${BACKEND_PCT}%"
  echo "$BACKEND_PCT" > "$BACKEND_BASELINE"
fi

# ── RESULT ───────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"
if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo -e "${RED}Push blocked: fix the issues above, then try again.${NC}"
  exit 1
fi

echo ""
check_pass "All coverage checks passed."
