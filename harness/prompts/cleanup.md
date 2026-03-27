---
description: Entropy cleanup — scan violations and fix top priority issues
---
Cleanup codebase:

1. Use `subagent` single mode — reviewer scans for violations:
   ```
   subagent({
     agent: "reviewer",
     task: "Scan entire codebase for quality violations: files > 300 lines, any types, missing JSDoc, lint issues, failing tests. Output structured list sorted by severity."
   })
   ```

2. For each violation found, create Beads tasks:
   `harness_task(action="create", title="Fix: <violation>", priority=<severity>, label="cleanup")`

3. Use `subagent` single mode — worker fixes top 3 violations:
   ```
   subagent({
     taskId: "<fix-task-id>",
     agent: "worker",
     task: "Fix this violation. Commit separately."
   })
   ```

4. Report cleanup results and updated quality status.
