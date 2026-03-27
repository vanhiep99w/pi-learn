---
description: Run scout → planner → worker pipeline for a Beads task
---
Implement: $@

Use the `subagent` tool with chain mode:

```
subagent({
  taskId: "<find matching task from bd ready, or create one>",
  chain: [
    { agent: "scout", task: "Explore codebase related to: $@" },
    { agent: "planner", task: "Create implementation plan from scout findings" },
    { agent: "worker", task: "Execute the implementation plan" }
  ]
})
```

Steps:
1. First run `harness_prime` to get current task context
2. Find or create the matching Beads task using `harness_task`
3. Run the subagent chain with the taskId
4. Report the final result to the user
