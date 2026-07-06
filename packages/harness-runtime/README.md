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
/harness-reflect-pi [last]
/harness-proposals
/harness-approve P-0001
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note <text>
```

## Safety

- Session discovery reads only the first JSONL line/header for listing.
- `inspect` parses a single explicit session file and returns metadata/tree, not full message content unless explicitly requested and redacted.
- `scan` writes normalized cache files under `~/.pi/harness/projects/<project-key>/sessions/<session-id>/`.
- Harness runtime logs are written under `~/.pi/harness/logs/` by default.
- Does not modify raw Pi session files.
- `reflect` builds LLM prompts only from normalized redacted cache excerpts, never raw session JSONL.
- Runtime does not keep a separate LLM API key; `/harness-reflect-pi` uses the current Pi session model.
- LLM reflection responses can be imported as draft proposals only if they include evidence refs, target files, risk, test plan and rollback plan.
- Proposal approve/reject/history only updates private proposal files under `~/.pi/harness`.
- `apply` requires an approved proposal plus a machine-applicable `## Patch` JSON block, checks git, creates `harness/P-0001`, and only edits files listed in the proposal target list.
- `rollback` restores uncommitted apply changes for the recorded changed paths, or reverts the recorded commit when `--commit` was used.
- `eval` runs deterministic regression scenarios and writes JSON/Markdown reports under `~/.pi/harness/projects/<project-key>/evals/`.
- `automate` is gated by `harness/config.json` and can only scan/report/draft proposals/eval; it never applies, commits, pushes, or reads raw logs beyond the normal normalized scan path.
- Creates/checks private harness home at `~/.pi/harness`.
- Project config is read from `<projectRoot>/harness/config.json` when present.
