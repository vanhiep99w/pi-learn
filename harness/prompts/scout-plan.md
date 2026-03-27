---
description: Scout → Planner only (no code changes)
---
Scout and plan: $@

Use the `subagent` tool with chain mode — READ ONLY, no code changes:

```
subagent({
  chain: [
    { agent: "scout", task: "Explore codebase for: $@" },
    { agent: "planner", task: "Create detailed implementation plan" }
  ]
})
```

Important: This pipeline only explores and plans. NO code changes.
Output the plan for human review.
