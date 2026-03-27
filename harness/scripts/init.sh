#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
# 🛡️ Agent Harness — Init Script
# Setup Beads + register extensions in USER's project
#
# Usage:
#   bash init.sh                 # uses current directory
#   bash init.sh /path/to/proj   # explicit project root
# ═══════════════════════════════════════════════════════

# Where the harness package lives (for verifying files)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_PKG="$(cd "$SCRIPT_DIR/.." && pwd)"

# Where the USER's project lives (for beads, .pi, .gitignore)
PROJECT_ROOT="${1:-$(pwd)}"
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${CYAN}→${NC} $1"; }
header() { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; }

# ─────────────────────────────────────────────
header "Agent Harness Init"
echo -e "${DIM}Project:  $PROJECT_ROOT${NC}"
echo -e "${DIM}Harness:  $HARNESS_PKG${NC}"
echo ""

# ═══════════════════════════════════════════════════════
# 1. CHECK / INSTALL BEADS (bd)
# ═══════════════════════════════════════════════════════

header "1. Beads CLI (bd)"

if command -v bd &>/dev/null; then
  BD_VERSION=$(bd --version 2>/dev/null || echo "unknown")
  ok "bd installed: $BD_VERSION"
else
  warn "bd not found — installing via npm..."
  if command -v npm &>/dev/null; then
    npm install -g @beads/bd
    if command -v bd &>/dev/null; then
      ok "bd installed via npm"
    else
      err "npm install failed. Try manually:"
      echo "  npm install -g @beads/bd"
      exit 1
    fi
  else
    err "npm not found. Install bd manually:"
    echo "  npm install -g @beads/bd"
    exit 1
  fi
fi

# ═══════════════════════════════════════════════════════
# 2. INIT BEADS DATABASE (in user's project)
# ═══════════════════════════════════════════════════════

header "2. Beads Database"

cd "$PROJECT_ROOT"

if [ -d ".beads" ]; then
  ok ".beads/ already exists"
else
  info "Initializing Beads in $PROJECT_ROOT..."
  bd init --stealth --quiet 2>/dev/null || bd init --stealth 2>/dev/null || {
    warn "bd init with --stealth failed, trying basic init..."
    bd init --quiet 2>/dev/null || bd init 2>/dev/null || {
      err "bd init failed. Run manually: cd $PROJECT_ROOT && bd init"
      exit 1
    }
  }
  ok "Beads initialized in $PROJECT_ROOT"
fi

# ═══════════════════════════════════════════════════════
# 3. UPDATE .gitignore (in user's project)
# ═══════════════════════════════════════════════════════

header "3. Git Ignore"

GITIGNORE="$PROJECT_ROOT/.gitignore"

add_to_gitignore() {
  local entry="$1"
  if [ -f "$GITIGNORE" ] && grep -qF "$entry" "$GITIGNORE"; then
    ok "$entry already in .gitignore"
  else
    echo "$entry" >> "$GITIGNORE"
    ok "Added $entry to .gitignore"
  fi
}

add_to_gitignore ".beads"

# ═══════════════════════════════════════════════════════
# 4. VERIFY HARNESS PACKAGE
# ═══════════════════════════════════════════════════════

header "4. Verify Harness Package"

REQUIRED_FILES=(
  "AGENTS.md"
  "agents/scout.md"
  "agents/planner.md"
  "agents/worker.md"
  "agents/reviewer.md"
  "extensions/harness-state/index.ts"
  "extensions/harness-subagent/index.ts"
  "extensions/harness-subagent/agents.ts"
  "extensions/harness-verify/index.ts"
  "prompts/implement.md"
  "prompts/triage.md"
  "package.json"
)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$HARNESS_PKG/$file" ]; then
    ok "$file"
  else
    err "MISSING: $file"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -gt 0 ]; then
  err "$MISSING files missing from harness package."
fi

# ═══════════════════════════════════════════════════════
# 5. CREATE SAMPLE TASKS (in user's project)
# ═══════════════════════════════════════════════════════

header "5. Sample Tasks"

cd "$PROJECT_ROOT"

TASK_COUNT=$(bd list 2>/dev/null | grep -cE "^\s*[a-zA-Z0-9]+-[a-zA-Z0-9]+" || echo "0")

if [ "$TASK_COUNT" -gt 0 ]; then
  ok "$TASK_COUNT tasks already exist"
else
  info "Creating sample epic with subtasks..."

  EPIC_OUTPUT=$(bd create "Harness System Setup" -t epic -p 1 2>/dev/null || echo "")
  EPIC_ID=$(echo "$EPIC_OUTPUT" | grep -oP 'bd-[a-f0-9]+' | head -1 || echo "")

  if [ -n "$EPIC_ID" ]; then
    ok "Created epic: $EPIC_ID"
    bd create "Test harness-state extension" -p 1 --parent "$EPIC_ID" 2>/dev/null && ok "Subtask 1 created" || warn "Subtask 1 failed"
    bd create "Test harness-subagent tool" -p 1 --parent "$EPIC_ID" 2>/dev/null && ok "Subtask 2 created" || warn "Subtask 2 failed"
    bd create "Test harness-verify hooks" -p 2 --parent "$EPIC_ID" 2>/dev/null && ok "Subtask 3 created" || warn "Subtask 3 failed"

    echo ""
    bd dep tree "$EPIC_ID" 2>/dev/null || true
  else
    warn "Could not create sample tasks (bd may not be initialized properly)"
  fi
fi

# ═══════════════════════════════════════════════════════
# 6. VERIFY BEADS WORKS
# ═══════════════════════════════════════════════════════

header "6. Verify Beads"

cd "$PROJECT_ROOT"

echo -e "${DIM}bd ready:${NC}"
bd ready 2>/dev/null || warn "bd ready failed"

echo ""
echo -e "${DIM}bd stats:${NC}"
bd stats 2>/dev/null || warn "bd stats failed"

# ═══════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════

header "✅ Init Complete"
echo ""
echo -e "${BOLD}Agent Harness is ready!${NC}"
echo ""
echo -e "  ${CYAN}Project:${NC}  $PROJECT_ROOT"
echo -e "  ${CYAN}Harness:${NC}  $HARNESS_PKG"
echo ""
echo -e "  ${CYAN}Usage (in Pi):${NC}"
echo "    /ready              — show available tasks"
echo "    /status             — dashboard"
echo "    /pipeline <id>      — full implementation pipeline"
echo "    /triage <desc>      — break down task"
echo ""
echo -e "  ${CYAN}Manual:${NC}"
echo "    bd ready            — find next work"
echo "    bd create \"...\"     — create task"
echo "    bd dep tree <id>    — view dependencies"
echo ""
echo -e "${DIM}Restart Pi to load extensions: ctrl+c → pi${NC}"
