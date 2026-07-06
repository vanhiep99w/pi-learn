# Wiki extension

The wiki extension is the repository's Pi-native OpenWiki variant. It generates and updates documentation under `wiki/` by sending a carefully constrained prompt to the **current Pi agent/model/tools**. It does not run the upstream OpenWiki CLI, LangChain model setup, DeepAgents runtime, OpenRouter fallback logic, or `~/.openwiki/.env` credential flow.

Sources: `packages/pi-learn-extensions/extensions/wiki/index.ts`, `packages/pi-learn-extensions/extensions/wiki/prompt.ts`, `packages/pi-learn-extensions/extensions/wiki/README.md`.

## Commands

```txt
/wiki-init [extra instructions]
/wiki-update [extra instructions]
/wiki-ask <question>
/wiki-status
```

Behavior summary:

- `/wiki-init` starts an initial documentation run for the current repository.
- `/wiki-update` refreshes existing wiki docs from repository changes. With no extra instructions, it skips when the repo appears unchanged since the last successful wiki update.
- `/wiki-ask` asks a repository/wiki question with lightweight wiki context.
- `/wiki-status` reports documentation presence, current git head, last metadata, and no-op update status.

## How a documentation run works

`index.ts` implements the runtime orchestration:

1. The command handler checks that the Pi agent is idle.
2. For `/wiki-update` without extra instructions, it calls no-op detection before starting.
3. It gathers context from git and previous metadata.
4. It snapshots current `wiki/` content, excluding `.last-update.json` from content-change churn.
5. It sends a generated prompt from `prompt.ts` into the current Pi session with `pi.sendUserMessage(...)`.
6. On `agent_end`, it snapshots `wiki/` again.
7. If documentation content changed, it writes `wiki/.last-update.json` with `updatedAt`, command, git head, and current model label.

The agent prompt explicitly tells the model not to edit `.last-update.json`; the extension writes that metadata itself.

## Git evidence and no-op logic

The extension mirrors OpenWiki's git-aware workflow at a high level. It gathers:

- working tree status with `git status --short --untracked-files=all`
- current `HEAD` with `git rev-parse HEAD`
- recent commits for init, or commits since the previous wiki `gitHead`/timestamp for update
- diff summary with `git diff --name-status HEAD`

No-op update detection uses `wiki/.last-update.json` when available:

- If there is no previous `gitHead`, update does not skip.
- If the working tree has meaningful changes outside the metadata file, update does not skip.
- If `HEAD` changed, the extension checks changed paths since the previous wiki head.
- If only wiki paths changed, an update may skip; otherwise it runs.

Source references: `createGitSummary`, `getUpdateNoopStatus`, `createOpenWikiContentSnapshot`, and `writeLastUpdateMetadata` in `packages/pi-learn-extensions/extensions/wiki/index.ts`.

## Prompt responsibilities

`prompt.ts` encodes the documentation discipline given to the current Pi agent. The prompt requires the agent to:

- inspect source and existing docs instead of inventing behavior
- use `wiki/quickstart.md` as the entrypoint
- keep the first pass focused and navigable
- use git history selectively
- protect secrets and sensitive logs
- update top-level `AGENTS.md`/`CLAUDE.md` with a standard Wiki reference section when needed
- create a temporary `wiki/_plan.md` before writing final docs and remove it before completion

The prompt is an adaptation of upstream OpenWiki rules for Pi execution, not a byte-for-byte upstream copy.

## Differences from upstream OpenWiki

The local README records the upstream base as `langchain-ai/openwiki@23428de0cc0b1b6d3e5d09be413e92a5d6ee451f` and lists the intentional differences.

Kept/adapted:

- `wiki/` documentation output directory
- `.last-update.json` update metadata semantics
- init/update/chat concepts as Pi slash commands
- git evidence and no-op update ideas
- snapshot-based metadata write only when docs content changes

Not ported:

- OpenWiki Ink CLI UI
- upstream command parser
- `~/.openwiki/.env` credentials
- LangChain model construction
- DeepAgents shell/backend runtime
- SQLite LangGraph checkpointer
- OpenRouter retry/fallback model handling

## Git history context

Recent repository history explains the current naming:

- `d61a063 Add Pi-native OpenWiki extension` introduced the extension as an OpenWiki-style Pi port.
- `204d927 Rename OpenWiki extension commands to wiki` renamed the command surface and directory to the shorter `wiki` terminology.

Current source paths and command names should therefore use `wiki`, not `openwiki`, unless describing upstream provenance.

## Change guidance

When changing this extension:

- Preserve the separation between **agent-generated docs** and **extension-written metadata**.
- Do not make the extension read or expose secret-bearing files.
- If prompt rules change, update `prompt.ts` and consider updating `packages/pi-learn-extensions/extensions/wiki/README.md` if behavior or upstream compatibility changes.
- If upstream OpenWiki is re-synced, follow the upgrade checklist in the local README and update the recorded upstream base commit.
- Verify behavior in Pi with `/wiki-status`, a no-op `/wiki-update`, and a documentation-changing `/wiki-update <note>` where appropriate.
