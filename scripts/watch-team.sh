#!/usr/bin/env bash
# watch-team.sh — Live monitor cho Aurora Teams
# Dùng: ./watch-team.sh [team-name]
# Dùng: ./watch-team.sh  (auto-detect team mới nhất)

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEAMS_DIR="$PROJECT_DIR/.pi/teams"

# ── Colors ────────────────────────────────────────────────────────
R='\033[0;31m'  # Red
G='\033[0;32m'  # Green
Y='\033[0;33m'  # Yellow
B='\033[0;34m'  # Blue
C='\033[0;36m'  # Cyan
M='\033[0;35m'  # Magenta
W='\033[1;37m'  # White bold
D='\033[2m'     # Dim
N='\033[0m'     # Reset

# ── Find team ─────────────────────────────────────────────────────
find_team() {
  local name="${1:-}"
  if [[ -n "$name" ]]; then
    echo "$TEAMS_DIR/$name"
    return
  fi
  # Auto: tìm team mới nhất (sửa đổi gần nhất)
  if [[ -d "$TEAMS_DIR" ]]; then
    find "$TEAMS_DIR" -maxdepth 1 -type d -newer "$TEAMS_DIR" 2>/dev/null \
      | head -1
  fi
}

# ── Parse tasks.json ───────────────────────────────────────────────
render_tasks() {
  local tasks_file="$1"
  [[ ! -f "$tasks_file" ]] && echo "  ${D}(no tasks yet)${N}" && return

  # Dùng python3 để parse JSON (node có thể không trong PATH)
  python3 - "$tasks_file" <<'PYEOF'
import json, sys, time

icons = {
  "done":             "\033[0;32m✓\033[0m",
  "in_progress":      "\033[0;33m⏳\033[0m",
  "assigned":         "\033[0;33m⏳\033[0m",
  "ready":            "\033[0;36m◎\033[0m",
  "pending":          "\033[2m○\033[0m",
  "failed":           "\033[0;31m✗\033[0m",
  "blocked":          "\033[0;31m⊘\033[0m",
  "waiting_approval": "\033[0;35m⏸\033[0m",
}
status_color = {
  "done":             "\033[0;32m",
  "in_progress":      "\033[0;33m",
  "assigned":         "\033[0;33m",
  "ready":            "\033[0;36m",
  "pending":          "\033[2m",
  "failed":           "\033[0;31m",
  "blocked":          "\033[0;31m",
  "waiting_approval": "\033[0;35m",
}
NC = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"

try:
  with open(sys.argv[1]) as f:
    data = json.load(f)
except:
  print("  (cannot read tasks.json)")
  sys.exit(0)

tasks = data.get("tasks", [])
if not tasks:
  print(f"  {DIM}(no tasks){NC}")
  sys.exit(0)

# Counts
counts = {}
for t in tasks:
  s = t.get("status","?")
  counts[s] = counts.get(s, 0) + 1

summary_parts = []
if counts.get("done"): summary_parts.append(f"\033[0;32m✓{counts['done']} done{NC}")
if counts.get("in_progress") or counts.get("assigned"):
  n = counts.get("in_progress",0) + counts.get("assigned",0)
  summary_parts.append(f"\033[0;33m⏳{n} running{NC}")
if counts.get("ready"): summary_parts.append(f"\033[0;36m◎{counts['ready']} ready{NC}")
if counts.get("pending"): summary_parts.append(f"{DIM}○{counts['pending']} pending{NC}")
if counts.get("failed"): summary_parts.append(f"\033[0;31m✗{counts['failed']} failed{NC}")
if counts.get("blocked"): summary_parts.append(f"\033[0;31m⊘{counts['blocked']} blocked{NC}")
if counts.get("waiting_approval"): summary_parts.append(f"\033[0;35m⏸ waiting approval{NC}")

print("  " + "  ".join(summary_parts))
print()

now = time.time() * 1000
for t in tasks:
  status = t.get("status", "?")
  icon = icons.get(status, "?")
  sc = status_color.get(status, "")
  title = t.get("title", "?")
  agent = t.get("agent", "")
  tid = t.get("id", "")

  elapsed = ""
  if t.get("started_at") and status in ("in_progress", "assigned"):
    secs = int((now - t["started_at"]) / 1000)
    if secs < 60: elapsed = f"  {DIM}{secs}s{NC}"
    else: elapsed = f"  {DIM}{secs//60}m{secs%60}s{NC}"

  agent_str = f"  {DIM}[{agent}]{NC}" if agent else ""
  id_str = f"  {DIM}{tid}{NC}"

  print(f"  {icon} {sc}{BOLD}{title}{NC}{agent_str}{elapsed}{id_str}")

  # Show result preview for done tasks
  result = t.get("result", "")
  if result and status == "done":
    preview = result[:120].replace("\n", " ")
    print(f"      {DIM}└ {preview}{'...' if len(result)>120 else ''}{NC}")

  # Show error for failed
  error = t.get("error", "")
  if error and status in ("failed", "blocked"):
    print(f"      {DIM}\033[0;31m└ {error[:100]}{NC}")

print()
PYEOF
}

# ── Main render ────────────────────────────────────────────────────
render() {
  local team_dir="$1"
  local team_name
  team_name="$(basename "$team_dir")"
  local tasks_file="$team_dir/tasks.json"
  local log_file="$team_dir/aurora.log"

  clear
  echo -e "${W}╔══════════════════════════════════════════════════════╗${N}"
  echo -e "${W}║   ${C}🌌 Aurora Teams Monitor${W}                         ║${N}"
  echo -e "${W}║   ${D}Team: ${W}${team_name}${D}  •  $(date '+%H:%M:%S')${W}                      ║${N}"
  echo -e "${W}╚══════════════════════════════════════════════════════╝${N}"
  echo

  echo -e "${B}━━━ Task Board ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
  render_tasks "$tasks_file"

  echo -e "${B}━━━ Live Logs (20 dòng gần nhất) ━━━━━━━━━━━━━━━━━━━${N}"
  if [[ -f "$log_file" ]]; then
    tail -20 "$log_file" | while IFS= read -r line; do
      # Highlight các pattern
      line="${line//✓/$(echo -e "${G}✓${N}")}"
      line="${line//✗/$(echo -e "${R}✗${N}")}"
      line="${line//▸/$(echo -e "${Y}▸${N}")}"
      line="${line//⟳/$(echo -e "${M}⟳${N}")}"
      line="${line//📢/$(echo -e "${C}📢${N}")}"
      echo -e "  $line"
    done
  else
    echo -e "  ${D}(log file chưa có — hãy chạy /team implement <goal>)${N}"
  fi

  echo
  echo -e "${D}Refresh mỗi 2s • Ctrl+C để thoát${N}"
}

# ── Entry point ────────────────────────────────────────────────────
main() {
  local team_name="${1:-}"
  local team_dir

  if [[ -n "$team_name" ]]; then
    team_dir="$TEAMS_DIR/$team_name"
    if [[ ! -d "$team_dir" ]]; then
      echo -e "${R}Error:${N} Team '$team_name' không tồn tại tại $team_dir"
      echo -e "Teams có sẵn:"
      ls "$TEAMS_DIR" 2>/dev/null || echo "  (không có)"
      exit 1
    fi
  else
    # Wait for any team to appear
    echo -e "${Y}Đang chờ team khởi động...${N}"
    echo -e "${D}Chạy /team implement <goal> trong Pi${N}"
    while [[ ! -d "$TEAMS_DIR" ]] || [[ -z "$(ls -A "$TEAMS_DIR" 2>/dev/null)" ]]; do
      sleep 1
    done
    # Get newest team
    team_dir="$(ls -td "$TEAMS_DIR"/*/ 2>/dev/null | head -1)"
    team_dir="${team_dir%/}"
    if [[ -z "$team_dir" ]]; then
      echo -e "${R}Không tìm thấy team nào${N}"
      exit 1
    fi
  fi

  echo -e "${G}Monitoring team: $(basename "$team_dir")${N}"
  sleep 0.5

  while true; do
    # Re-detect nếu có team mới hơn (và không chỉ định tên)
    if [[ -z "$team_name" ]]; then
      local newest
      newest="$(ls -td "$TEAMS_DIR"/*/ 2>/dev/null | head -1)"
      newest="${newest%/}"
      [[ -n "$newest" ]] && team_dir="$newest"
    fi

    render "$team_dir"
    sleep 2
  done
}

main "${1:-}"
