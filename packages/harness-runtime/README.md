# Harness Runtime

Read-only runtime for Pi session observability and improvement proposals.

Current scope: read-only session cache/reporting, deterministic proposals, and controlled proposal lifecycle/apply MVP.

## Commands

```bash
node ./src/cli.js --help
node ./src/cli.js doctor --project /path/to/project
node ./src/cli.js config print --project /path/to/project
node ./src/cli.js project resolve --project /path/to/project
node ./src/cli.js sessions --project /path/to/project --last 5
node ./src/cli.js scan --project /path/to/project --last 5
node ./src/cli.js report --project /path/to/project --last 5
node ./src/cli.js reflect --project /path/to/project --last 5
node ./src/cli.js reflect --import /path/to/llm-response.json --project /path/to/project
node ./src/cli.js propose --project /path/to/project --last 5 --rules
node ./src/cli.js propose --project /path/to/project --last 5 --llm
node ./src/cli.js propose --project /path/to/project --last 5 --target memory
node ./src/cli.js propose --project /path/to/project --last 5 --target rules
node ./src/cli.js propose --project /path/to/project --last 5 --target parser
node ./src/cli.js propose --project /path/to/project --last 5 --target redaction
node ./src/cli.js proposals --project /path/to/project
node ./src/cli.js show P-0001 --project /path/to/project
node ./src/cli.js approve P-0001 --project /path/to/project
node ./src/cli.js reject P-0001 --project /path/to/project
node ./src/cli.js history P-0001 --project /path/to/project
node ./src/cli.js apply P-0001 --project /path/to/project --skip-tests
node ./src/cli.js rollback P-0001 --project /path/to/project
node ./src/cli.js inspect /path/to/session.jsonl --tree --active-path
node ./src/cli.js inspect /path/to/session.jsonl --entry <entry-id> --full
```

When linked/installed, the canonical CLI command is:

```bash
harness doctor
```

## Safety

- Session discovery reads only the first JSONL line/header for listing.
- `inspect` parses a single explicit session file and prints metadata/tree, not full message content.
- `scan` writes normalized cache files under `~/.pi/harness/projects/<project-key>/sessions/<session-id>/`.
- Harness runtime logs are written under `~/.pi/harness/logs/` by default.
- Does not modify raw Pi session files.
- `reflect` builds LLM prompts only from normalized redacted cache excerpts, never raw session JSONL.
- Runtime does not keep a separate LLM API key; use `/harness-reflect-pi` in the Pi extension to run the current Pi session model.
- LLM reflection responses can be imported as draft proposals only if they include evidence refs, target files, risk, test plan and rollback plan.
- Proposal approve/reject/history only updates private proposal files under `~/.pi/harness`.
- `apply` requires an approved proposal plus a machine-applicable `## Patch` JSON block, checks git, creates `harness/P-0001`, and only edits files listed in the proposal target list.
- `rollback` restores uncommitted apply changes for the recorded changed paths, or reverts the recorded commit when `--commit` was used.
- Creates/checks private harness home at `~/.pi/harness`.
- Project config is read from `<projectRoot>/harness/config.json` when present.
