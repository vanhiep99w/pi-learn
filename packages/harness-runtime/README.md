# Harness Runtime

Read-only runtime for Pi session observability and improvement proposals.

Current scope: Phase 0 skeleton.

## Commands

```bash
node ./src/cli.js --help
node ./src/cli.js doctor --project /path/to/project
node ./src/cli.js config print --project /path/to/project
node ./src/cli.js project resolve --project /path/to/project
node ./src/cli.js sessions --project /path/to/project --last 5
node ./src/cli.js scan --project /path/to/project --last 5
node ./src/cli.js inspect /path/to/session.jsonl --tree --active-path
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
- Creates/checks private harness home at `~/.pi/harness`.
- Project config is read from `<projectRoot>/harness/config.json` when present.
