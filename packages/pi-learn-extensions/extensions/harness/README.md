# Pi Harness extension

Single public Pi extension entrypoint for Harness session observability, reports, reflection proposals, controlled apply, evals, and Harness Wiki repository knowledge.

```txt
index.ts          # public Pi extension entrypoint
wiki-commands.ts  # Harness Wiki commands, snapshots, metadata, status, protection
wiki-prompt.ts    # Pi-native documentation task prompt
```

## Harness commands

```txt
/harness-status [last]
/harness-report [last]
/harness-improve [last]
/harness-proposals
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note [text]
```

Trong TUI, `/harness-proposals` là workflow review duy nhất: chọn proposal, xem tóm tắt, mở Markdown đầy đủ, rồi approve, reject hoặc approve & apply với bước xác nhận. Proposal có JSON Patch sẽ hiện action `Approve & Apply`; proposal đã approved sẽ hiện `Apply`. Các operation approve/reject/apply vẫn nằm trong Harness runtime nhưng không còn được đăng ký thành slash command riêng cho approve/reject. Ở print/JSON mode, command này chỉ in danh sách proposal.

## Harness Wiki commands

```txt
/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
/harness-wiki-status
```

The old `/wiki-*` commands are intentionally removed without compatibility aliases.

## Harness Wiki behavior

- Generates and updates normal repository documentation under `wiki/` using the current Pi provider/model/tools.
- Writes update metadata at `wiki/.last-update.json` only when normal Wiki documentation changes.
- Loads the optional user-owned `wiki/INSTRUCTIONS.md` brief into init/update/ask prompts without treating it as generated documentation.
- Treats `wiki/**/_rules.md` as reviewed prompt rules, not generated documentation.
- Creates deterministic empty `_rules.md` scaffolds for root/final sections when missing.
- Blocks Pi tool turns from modifying `_rules.md` or `.last-update.json` through write/edit and common shell mutation paths; active Wiki runs also protect `wiki/INSTRUCTIONS.md`.
- Excludes `INSTRUCTIONS.md`, `_rules.md`, `.last-update.json`, `_plan.md`, hidden files, and temporary files from the documentation snapshot.
- Tracks substantial areas deferred by the initial page budget in a concise `## Backlog` at the end of `wiki/quickstart.md`; update runs preserve or resolve entries using repository evidence.
- Treats prompt-rule, Wiki brief, source, and configuration changes as meaningful repository changes for update/no-op decisions.

## Persistent Wiki brief

`wiki/INSTRUCTIONS.md` is optional user-owned control metadata for documentation scope, priorities, language, exclusions, and intended audience. Harness reads at most 64 KiB from a regular non-symlink file and includes it in init/update/ask task prompts. Normal Wiki runs cannot modify it; users can edit it in a regular Pi turn or directly in their editor. Reviewed `wiki/**/_rules.md` instructions and deterministic safety controls take precedence over the brief.

## Prompt-rule loading

Harness does not inject all prompt rules into every request. The model follows this lazy loading chain:

```txt
AGENTS.md
  → wiki/quickstart.md
  → wiki/_rules.md
  → applicable section/_rules.md
```

The model loads rule content with its `read` tool. There is no rule-content watcher/cache and Markdown changes do not require `/reload`; extension source changes still require `/reload`.

Prompt rules are guidance, not a security boundary. Approval, target allowlists, path protection, redaction, and controlled apply remain deterministic runtime/extension behavior.

## OpenWiki provenance

Harness Wiki is a Pi-native adaptation of OpenWiki. Initial upstream base:

```txt
repository: langchain-ai/openwiki
commit: 23428de0cc0b1b6d3e5d09be413e92a5d6ee451f
short:  23428de fix: use dash-delimited Anthropic model id for Opus (claude-opus-4-8) (#113)
date checked locally: 2026-07-06
latest upstream check: e1a2fea77048f342c6317c457b3dca6efe5ec209 (2026-07-15)
latest prompt review: e1a2fea77048f342c6317c457b3dca6efe5ec209 (after OpenWiki 0.1.2, 2026-07-15)
latest prompt behavior ported: 2fb44a876db8cca461ad1c0767931d95495763a3 (documentation coverage backlog)
```

Kept/adapted:

- Wiki init/update/chat concepts.
- `wiki/` output and `.last-update.json` metadata.
- Git evidence collection and no-op update behavior.
- Documentation quality, planning, privacy, update discipline, and deferred-area backlog tracking.
- User-owned persistent Wiki brief adapted from OpenWiki `openwiki/INSTRUCTIONS.md`.

Intentionally different:

- No OpenWiki CLI/Ink UI, credential flow, LangChain/DeepAgents runtime, SQLite checkpointer, or separate provider key.
- Pi slash commands and the current Pi model/tools perform the work.
- Harness owns the Wiki capability; there is no second `extensions/wiki/` entrypoint.
- Domain-local reviewed rules are Markdown prompts under `wiki/**/_rules.md`.

## Upstream upgrade checklist

1. Fetch the latest `langchain-ai/openwiki` source and record the commit.
2. Compare prompt, agent workflow, command, git/update, and generated-doc changes against the base commit above.
3. Port only behavior relevant to the Pi-native Harness Wiki module.
4. Preserve Harness command names, prompt-rule ownership, lazy loading, metadata semantics, and Pi UI safety.
5. Update this provenance block and run runtime tests plus manual `/reload` verification.
