# Agent Harness

## Task Management
Use `bd` (Beads) for task tracking:
- `bd ready` — find next work (no blockers)
- `bd update <id> --claim` — claim task
- `bd close <id> --reason "..."` — complete task
- `bd dep tree <id>` — view dependencies
- `bd prime` — full agent context dump

## Tools
- `subagent(taskId, agent|chain, task)` — delegate to sub-agent
- `harness_prime()` — get Beads context
- `harness_task(action, ...)` — create/claim/close tasks

## Agents
- `harness/agents/scout.md` — recon, read-only, fast (Haiku)
- `harness/agents/planner.md` — plan, read-only (Sonnet)
- `harness/agents/worker.md` — execute, 1 task/session (Sonnet)
- `harness/agents/reviewer.md` — review, structured pass/fail (Sonnet)

## Pipelines
- `/implement <task>` — scout → planner → worker
- `/review-fix <task>` — worker → reviewer → worker(fix)
- `/triage <desc>` — scout → create epic + subtasks
- `/full-pipeline <task>` — scout → planner → worker → reviewer

## Rules
1. One task per session. `bd ready` → claim → implement → close.
2. Commit after each completed task.
3. Swallow success output, surface failures only.
4. Never edit: `.env`, `.beads/`, `package-lock.json`.
5. **NEVER write/edit files directly.** All implementation MUST go through `subagent` worker.
6. **NEVER implement yourself** when user asks to build/create/fix something. Always delegate: `subagent(agent="worker", task="...")` or use chain mode.
