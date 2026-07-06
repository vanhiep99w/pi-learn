# Wiki Pi-native extension

Pi-native port of OpenWiki usage with a shorter `wiki/` output folder and `/wiki-*` commands. It keeps the documentation workflow (`wiki/`, git context, no-op update detection, `.last-update.json`) but delegates the actual documentation work to the current Pi agent/model/tools instead of running the OpenWiki CLI/DeepAgents runtime.

## Upstream base

This extension was initially ported from `langchain-ai/openwiki` at:

```txt
commit: 23428de0cc0b1b6d3e5d09be413e92a5d6ee451f
short:  23428de fix: use dash-delimited Anthropic model id for Opus (claude-opus-4-8) (#113)
date checked locally: 2026-07-06
local checkout: /tmp/openwiki
```

Primary upstream files consulted:

```txt
README.md
openwiki/quickstart.md
openwiki/architecture/overview.md
openwiki/agent/workflow.md
openwiki/cli/usage.md
openwiki/operations/credentials-and-updates.md
src/agent/index.ts
src/agent/prompt.ts
src/agent/utils.ts
src/agent/types.ts
src/constants.ts
src/env.ts
src/commands.ts
```

## Commands

```txt
/wiki-init [extra instructions]
/wiki-update [extra instructions]
/wiki-ask <question>
/wiki-status
```

## Behavior

- `/wiki-init` asks Pi to generate initial docs under `wiki/`.
- `/wiki-update` asks Pi to refresh docs based on git changes. With no extra instructions, it skips if the repo appears unchanged since the last wiki metadata entry.
- `/wiki-ask` sends a repository/wiki question to Pi with lightweight wiki context.
- `/wiki-status` reports docs presence, git head, last metadata, and no-op status via Pi UI notification.
- After an init/update agent turn ends, the extension snapshots `wiki/`; if content changed, it writes `wiki/.last-update.json`.

## Differences from upstream OpenWiki

This is **not** a 1:1 runtime port. It is the Pi-native variant.

Kept/adapted from upstream:

- `wiki/` is the documentation output directory instead of upstream `openwiki/`.
- `wiki/.last-update.json` is the update metadata file instead of upstream `openwiki/.last-update.json`.
- Init/update/chat concepts are preserved as Pi slash commands.
- Git evidence collection mirrors upstream at a high level:
  - `git status --short --untracked-files=all`
  - `git rev-parse HEAD`
  - recent commits or changes since previous `gitHead`/`updatedAt`
  - `git diff --name-status HEAD`
- Update no-op detection is preserved in spirit: skip `/wiki-update` when there are no meaningful repo changes.
- Content snapshot behavior is preserved in spirit: hash `wiki/` and exclude `.last-update.json` so metadata-only changes do not churn updates.
- Metadata is written only when docs content changes.

Intentionally different:

- No OpenWiki CLI/Ink UI (`src/cli.tsx`) is ported.
- No OpenWiki command parser (`src/commands.ts`) is used; Pi slash commands replace it.
- No `~/.openwiki/.env` credential flow is used.
- No `src/credentials.tsx` onboarding is ported.
- No LangChain model construction is used.
- No DeepAgents `createDeepAgent()` or `LocalShellBackend` is used.
- No SQLite LangGraph checkpointer is used.
- No OpenRouter fallback route/model retry logic is used.
- The current Pi provider/model/tools perform the actual documentation work.
- Prompt text is adapted for Pi-native execution and is **not byte-for-byte identical** to upstream `src/agent/prompt.ts`, but local `prompt.ts` ports most upstream documentation discipline, git discipline, security, AGENTS/CLAUDE guidance, init/update behavior, and quality rules.
- The extension tells Pi not to edit `.last-update.json`; it writes metadata itself after `agent_end`.
- Output/status uses Pi `ctx.ui` notifications/status instead of OpenWiki streaming UI.

## Upgrade checklist when upstream OpenWiki changes

1. In `/tmp/openwiki`, update upstream and note the new commit:

   ```bash
   cd /tmp/openwiki
   git fetch origin
   git checkout main
   git pull --ff-only
   git rev-parse HEAD
   git log -1 --oneline
   ```

2. Compare upstream files against the base commit above:

   ```bash
   git diff 23428de0cc0b1b6d3e5d09be413e92a5d6ee451f..HEAD -- \
     src/agent/prompt.ts \
     src/agent/utils.ts \
     src/agent/index.ts \
     src/agent/types.ts \
     src/constants.ts \
     src/env.ts \
     src/commands.ts \
     README.md \
     openwiki/
   ```

3. Port only changes relevant to this Pi-native extension:

   - Prompt/product rules from `src/agent/prompt.ts` into local `prompt.ts`, while preserving Pi-native wording.
   - Git evidence, no-op update, snapshot, metadata semantics from `src/agent/utils.ts`.
   - Command semantics from `src/commands.ts`/README if new user-facing modes are added.
   - Documentation structure expectations from upstream generated `openwiki/` docs.

4. Usually ignore upstream changes that only affect:

   - Ink UI in `src/cli.tsx`.
   - Credential onboarding in `src/credentials.tsx`.
   - Provider/model creation and fallback in `src/agent/index.ts` unless it changes user-visible OpenWiki semantics.
   - `~/.openwiki/.env` diagnostics in `src/env.ts` unless metadata or docs workflow semantics change.

5. After porting, update the `Upstream base` block in this README to the new commit.

## Notes

This extension intentionally does not use `~/.openwiki/.env`, LangChain, or DeepAgents. It uses the current Pi provider/model and Pi tools.

Current local implementation files:

```txt
index.ts   # Pi slash commands, git context, no-op checks, snapshots, metadata writes
prompt.ts  # Pi-native adaptation of upstream OpenWiki prompt rules
README.md  # base commit, differences, and upgrade checklist
```
