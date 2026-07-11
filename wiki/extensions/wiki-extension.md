# Harness Wiki capability

Harness Wiki is the repository-knowledge capability of the single public Harness extension. It preserves the useful Pi-native OpenWiki workflow while sharing command ownership, safety, proposals, and status with Harness.

Sources:

```txt
packages/pi-learn-extensions/extensions/harness/index.ts
packages/pi-learn-extensions/extensions/harness/wiki-commands.ts
packages/pi-learn-extensions/extensions/harness/wiki-prompt.ts
packages/pi-learn-extensions/extensions/harness/README.md
packages/harness-runtime/src/analysis/wiki-prompt-rules.js
```

## Commands

```txt
/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
/harness-wiki-status
```

The old `/wiki-*` commands are intentionally absent; there are no deprecated or hidden aliases.

## Command behavior

- `/harness-wiki-init` creates missing deterministic prompt-rule scaffolds, then starts an initial documentation run with the current Pi model/tools.
- `/harness-wiki-update` inspects existing docs, metadata, git history, and worktree changes. Without extra instructions it skips when only already-accounted-for documentation/metadata changes exist.
- `/harness-wiki-ask` asks a repository/Wiki question without modifying docs by default.
- `/harness-wiki-status` reports docs snapshot, metadata/no-op status, prompt-rule files, missing section scaffolds, rule IDs, and lint errors/warnings.

The command-specific instructions are sent as a user task prompt. They are not a replacement system prompt. When present, the user-owned `wiki/INSTRUCTIONS.md` brief is also included in init/update/ask prompts.

## Persistent Wiki brief

`wiki/INSTRUCTIONS.md` is optional user-owned control metadata for documentation scope, priorities, language, exclusions, and intended audience. Harness reads at most 64 KiB from a regular non-symlink file and includes the content in init/update/ask prompts.

Normal Harness Wiki runs cannot modify this file. Users may edit it directly or in a regular Pi turn. It is excluded from generated-documentation snapshots, but a worktree or committed change to the brief remains meaningful for `/harness-wiki-update` no-op detection. Reviewed `wiki/**/_rules.md` instructions and deterministic privacy/protection/apply controls take precedence over the brief.

## Prompt-rule loading

Reviewed prompt rules use one Markdown file for root and each final Wiki section:

```txt
wiki/_rules.md
wiki/architecture/_rules.md
wiki/extensions/_rules.md
wiki/operations/_rules.md
```

Loading is lazy:

```txt
Pi auto-loads AGENTS.md
  → model reads wiki/quickstart.md
  → model reads wiki/_rules.md
  → model identifies target domains
  → model reads applicable section/_rules.md
  → rule text enters context as read-tool results
```

The extension does not use `before_agent_start`, `context`, or provider-payload rewriting to inject all rules. It does not maintain a rule-content watcher or mtime/hash cache. A later `read` sees current file content, so editing Markdown rules does not require `/reload`; changing extension code does.

This is best-effort prompt discipline. File protection, approval, target allowlists, path safety, redaction, and rollback remain deterministic code behavior.

## Ownership and file protection

| Path | Owner |
|---|---|
| Normal `wiki/**/*.md` pages | Harness Wiki documentation workflow |
| `wiki/INSTRUCTIONS.md` | User-owned persistent Wiki brief |
| `wiki/**/_rules.md` | Harness proposal → approval → controlled apply |
| `wiki/.last-update.json` | Harness Wiki metadata finalizer |
| `wiki/_plan.md` | Temporary documentation run; removed before completion |

The Harness extension blocks built-in write/edit and common shell mutation attempts against `_rules.md` and `.last-update.json` in normal Pi tool turns. Approved `/harness-apply` writes through the controlled runtime lifecycle rather than model tool calls.

Missing `_rules.md` files are a narrow bootstrap exception: the extension may create deterministic prompt-empty scaffolds for root/final sections. It does not invent policy or proposal origins.

## Snapshot and metadata

The documentation snapshot hashes only normal Wiki Markdown. It excludes:

```txt
wiki/INSTRUCTIONS.md
wiki/**/_rules.md
wiki/.last-update.json
wiki/_plan.md
hidden/temp files
```

After `agent_settled`:

1. Harness creates any missing final-section scaffolds.
2. It recomputes the normal documentation snapshot.
3. It writes `.last-update.json` only when that snapshot changed.
4. Scaffold-only or prompt-rule-only changes do not create a fake documentation update.

A prompt-rule or `wiki/INSTRUCTIONS.md` Git change is still meaningful for no-op detection because normal docs may need to reflect updated workflow, policy, scope, or priorities.

## Rule validation and controlled apply

`packages/harness-runtime/src/analysis/wiki-prompt-rules.js` provides lightweight Markdown/path lint:

- Reserved basename `_rules.md`.
- Root/final-section completeness.
- Project-root and symlink safety.
- UTF-8/NUL/64 KiB checks.
- Stable rule-heading IDs and duplicate detection.
- Proposal-origin syntax checks.

It does not parse natural language into detector parameters or build an effective runtime detector registry. Status always reports lint errors; init/update/ask fail closed after deterministic scaffold creation if the prompt-rule layout remains invalid.

Approved prompt-rule proposals patch exact Markdown blocks. Controlled apply validates the complete prompt-rule layout afterward and restores original content if validation fails.

## No-op update behavior

`/harness-wiki-update` runs when:

- No previous update Git head exists.
- The worktree has meaningful changes other than metadata.
- Prompt rules changed.
- Source/config paths changed.
- Git changed but changed paths cannot be determined safely.

It may skip when all committed changes since the previous update are normal Wiki documentation/metadata and the worktree is otherwise clean.

## OpenWiki provenance

The initial Pi-native port used `langchain-ai/openwiki@23428de0cc0b1b6d3e5d09be413e92a5d6ee451f` as its upstream base. The prompt was reviewed through `fa9a9b519d65ea6a31b5d063ba5d97edb1fca0f0` (OpenWiki 0.1.1); Harness selectively adapted the user-owned persistent Wiki brief rather than porting OpenWiki's personal-wiki/connectors runtime.

Harness Wiki intentionally does not use OpenWiki's CLI/Ink UI, credential flow, LangChain/DeepAgents runtime, SQLite checkpointer, or separate model/provider key. See `packages/pi-learn-extensions/extensions/harness/README.md` for the upgrade checklist.

## Verification

```bash
npm --prefix packages/harness-runtime test
```

Then reload Pi and verify:

```txt
/reload
/harness-wiki-status
/harness-wiki-ask Prompt rules được load vào context thế nào?
/harness-wiki-update
```

Also verify `/wiki-status` is absent and a normal Harness Wiki turn cannot modify `_rules.md`.
