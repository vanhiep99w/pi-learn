---
description: Full cycle — scout → planner → worker → reviewer → fix
---
Full pipeline: $@

Run complete implementation cycle:

1. Run `harness_prime` to get task context
2. Find or create matching Beads task
3. Use `subagent` chain:
   ```
   subagent({
     taskId: "<task-id>",
     chain: [
       { agent: "scout", task: "Explore codebase for: $@" },
       { agent: "planner", task: "Create implementation plan" },
       { agent: "worker", task: "Execute the plan" }
     ]
   })
   ```
4. After worker completes, run reviewer:
   ```
   subagent({
     taskId: "<task-id>",
     agent: "reviewer",
     task: "Review the implementation against the plan"
   })
   ```
5. If reviewer returns CHANGES REQUESTED:
   - Worker fixes issues
   - Re-run reviewer
6. Report final result with task status
