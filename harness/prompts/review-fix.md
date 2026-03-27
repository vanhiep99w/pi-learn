---
description: Worker → Reviewer → Worker(fix) loop until approved
---
Review and fix: $@

Steps:
1. Run `harness_prime` to get task context
2. Use `subagent` single mode: worker implements the changes
3. Use `subagent` single mode: reviewer reviews the implementation
4. If reviewer returns CHANGES REQUESTED:
   - Note the issues from reviewer
   - Use `subagent` single mode: worker fixes the issues
   - Re-run reviewer
5. Repeat until reviewer returns APPROVED
6. Report final result

Max iterations: 3. If still not approved after 3 rounds, report remaining issues to user.
