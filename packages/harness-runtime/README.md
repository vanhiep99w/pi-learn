# Harness Runtime

Runtime API for Pi session observability, reports, proposals, reflection, controlled apply, and evals.

Primary UX is the Pi extension in:

```txt
packages/pi-learn-extensions/extensions/harness/index.ts
```

This package no longer exposes a standalone CLI/bin. The extension imports `src/api.js` directly so runtime logic stays centralized without spawning a child process or keeping a separate LLM API key.

## API modules

```js
import {
  sessions,
  scan,
  report,
  reflect,
  importReflection,
  propose,
  proposals,
  approve,
  reject,
  apply,
  rollback,
  history,
  evalHarness,
  automationStatus,
  automate,
} from "@pi-learn/harness-runtime";
```

Most functions accept the same option shape:

```js
{
  project: "/path/to/project",
  sessionDir: "/path/to/pi/sessions",
  harnessHome: "/path/to/private/harness-home",
  maxSessionsPerScan: 5
}
```

## Pi extension commands

```txt
/harness-status [last]
/harness-report [last]
/harness-improve [last]
/harness-proposals
/harness-approve P-0001
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note <text>

/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
/harness-wiki-status
```

`/harness-reflect-pi [last]` remains a deprecated compatibility alias for `/harness-improve [last]`.

Harness Wiki is registered from the same public `harness/index.ts` entrypoint. The legacy `/wiki-*` commands and `extensions/wiki/` entrypoint are removed.

## Prompt rules

Reviewed project guidance lives in Markdown:

```txt
wiki/_rules.md
wiki/<section>/_rules.md
```

Pi loads the bootstrap instruction from `AGENTS.md`; the model then reads `wiki/quickstart.md`, root rules, and applicable section rules. Harness does not parse these prompts as detector config or inject every rule automatically.

Deterministic detectors/defaults remain in `src/analysis/rules.js`. `src/analysis/wiki-prompt-rules.js` only discovers, scaffolds, classifies, and lints reserved prompt-rule files for status/protection/controlled apply.

## Safety

- Session discovery reads only the first JSONL line/header for listing.
- `inspect` parses a single explicit session file and returns metadata/tree, not full message content unless explicitly requested and redacted.
- `scan` writes normalized cache files under `~/.pi/harness/projects/<project-key>/sessions/<session-id>/`.
- Harness runtime logs are written under `~/.pi/harness/logs/` by default.
- Does not modify raw Pi session files.
- `reflect` builds LLM prompts only from normalized redacted cache excerpts, never raw session JSONL.
- Successful tool results are compact in reflection prompts: output bodies are omitted while status, timing when derivable, output size, and a `normalizedRef` locator are retained. Failed tool results keep a bounded redacted excerpt.
- A reflection model may use an available file-reading tool to inspect exactly one referenced line in normalized `events.jsonl` when compact evidence is insufficient. It must verify the referenced `eventId` and must never follow `sessionFile`, `rawRef`, or paths under `~/.pi/agent/sessions/`.
- Assistant thinking blocks are omitted from normalized message excerpts; final assistant text and thinking-level change metadata remain available.
- Runtime does not keep a separate LLM API key; `/harness-improve` uses the current Pi session model.
- LLM reflection responses can be imported as draft proposals only if they include evidence refs, target files, risk, test plan and rollback plan.
- Proposal approve/reject/history only updates private proposal files under `~/.pi/harness`.
- `apply` requires an approved proposal plus a machine-applicable `## Patch` JSON block, checks git, creates `harness/P-0001`, and only edits files listed in the proposal target list.
- Changes to `wiki/**/_rules.md` are linted after apply; invalid changes are restored before apply fails.
- Normal Pi tool turns block write/edit and common shell mutations of `_rules.md` and `.last-update.json`; approved controlled apply writes through runtime code.
- `rollback` restores uncommitted apply changes for the recorded changed paths, or reverts the recorded commit when `--commit` was used.
- `eval` runs deterministic regression scenarios and writes JSON/Markdown reports under `~/.pi/harness/projects/<project-key>/evals/`.
- `automate` is gated by `harness/config.json` and can only scan/report/draft proposals/eval; it never applies, commits, pushes, or reads raw logs beyond the normal normalized scan path.
- Creates/checks private harness home at `~/.pi/harness`.
- Project config is read from `<projectRoot>/harness/config.json` when present.
