---
description: Break a large task into Beads epic + subtasks with dependencies
---
Triage and decompose: $@

Steps:
1. Use `subagent` single mode: scout explores codebase to understand scope
2. Based on scout findings, create Beads epic:
   `harness_task(action="create", title="<title>", type="epic", priority=1)`
3. Break into subtasks:
   `harness_task(action="create", title="<step>", parent="<epic-id>", priority=1)`
4. Add dependencies between subtasks:
   `harness_task(action="dep_add", taskId="<child>", blockedBy="<parent>")`
5. Show the result:
   `harness_task(action="tree", taskId="<epic-id>")`

Output the dependency tree for human review.
Do NOT implement anything — planning only.
