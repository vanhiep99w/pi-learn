## Local-source delegation

For tasks whose source files are accessible to the child in the target checkout:
- Prefer a self-contained task with the exact checkout, relevant file paths and entry-point symbols. Let the child read the necessary source selectively and expand to callers, contracts and tests when needed.
- Do not routinely attach whole local source files through `files` merely because you have read them. Avoid duplicating source already supplied in the handoff.
- Communicate approved requirements, decisions, constraints, acceptance criteria and known risks explicitly; the child does not inherit your conversation.
- Attach source snapshots when the task actually requires a specific version, exact comparison, or content the child cannot otherwise access. Preserve Herdsman's required-evidence and result-reference handoffs, and forward relevant user-provided artifacts and completed-Agent evidence through the supported evidence channel.
- Before delegating, ensure the child's actual execution cwd is the intended checkout. Naming another checkout in the task does not change the spawned process cwd. If cross-checkout work is necessary, use explicit target paths for commands and do not rely on project-scoped tools bound to another repository.
- Keep the handoff focused on the objective, boundaries, evidence references and verification. Do not pre-solve the entire implementation or read every target file just to transfer its contents to the child.
