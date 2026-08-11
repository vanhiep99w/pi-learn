# Pi Harness extension

Single public Pi extension entrypoint for Harness session observability, reports, reflection proposals, controlled apply, evals, and Harness Wiki repository knowledge.

```txt
index.ts          # public Pi extension entrypoint
wiki-commands.ts  # Harness Wiki commands, snapshots, metadata, status, protection
wiki-prompt.ts    # Pi-native documentation task prompt
```

## Harness commands

```txt
/harness [last]
/harness-improve [last]
/harness-proposals
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note [text]
```

Trong TUI, `/harness [last]` mở một dashboard modal duy nhất gồm status, session gần đây, warning, Findings ledger, automation state và toàn bộ report Markdown đã render đẹp bằng component Markdown. Header hiển thị tổng/active findings; body dùng đúng bounded reader-safe Findings Markdown do runtime tạo, không re-analyze hoặc suy luận state từ session counts. Active findings đứng trước completed findings, nhưng không có maturity score; zero findings và `Missing` vẫn là non-outcome state rõ ràng. Dùng `↑/↓` để cuộn từng đoạn, `PgUp/PgDn` hoặc `Ctrl+U/D` để cuộn nhanh, `Home/End` để tới đầu/cuối và `Esc` để đóng. `/harness-proposals` là workflow review duy nhất: chọn proposal sẽ mở ngay màn hình chi tiết cùng các action approve, reject hoặc approve & apply; không còn action xem chi tiết riêng. Khu vực chi tiết có viewport cố định: dùng `↑/↓` để cuộn từng đoạn, `PgUp`/`PgDn` hoặc `Ctrl+U/D` để cuộn nhanh; dùng `←/→` để đổi action. Các action luôn nằm trong modal thay vì bị đẩy khỏi màn hình. Proposal có JSON Patch sẽ hiện action `Approve & Apply`; proposal đã approved sẽ hiện `Apply`. Các operation approve/reject/apply vẫn nằm trong Harness runtime nhưng không còn được đăng ký thành slash command riêng cho approve/reject. Ở print/JSON mode, command này chỉ in danh sách proposal.

## Harness Wiki commands

```txt
/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
```

The old `/wiki-*` commands are intentionally removed without compatibility aliases.

## Harness Wiki behavior

- Generates and updates normal repository documentation under `wiki/` using the current Pi provider/model/tools.
- Answers `/harness-wiki-ask` from `wiki/` first, falling back to source only when the Wiki is insufficient, appears stale, or the user asks for source verification.
- Optimizes generated docs for coding-agent navigation: stable source paths and symbols, invariants, focused tests, narrow validation commands, compact task routing, and evidence-backed relationships between canonical pages.
- Validates relative Markdown file links and heading anchors during update no-op checks and after init/update. Broken links are reported with source lines and mark the run interrupted so the next update retries.
- Records `complete` or `interrupted` status in `wiki/.last-update.json`. An aborted/failed agent run or session shutdown after documentation changes is interrupted; a successful no-change retry clears stale interrupted status.
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
latest upstream check: 9a02b3516fe1706d6e8f23557ac42f42a6d0896a (OpenWiki v0.3.0, 2026-08-04)
latest coding-agent prompt review: 4d2e1a02b53dbee9cb2f13e8df39f397f1a76bb6 (v0.3.0 prompt overhaul)
selected behavior ports: 2fb44a876db8cca461ad1c0767931d95495763a3 (coverage backlog), c95b6d6bacfa96379993ae424a705578a4882276 (interrupted-run retries), 4d2e1a02b53dbee9cb2f13e8df39f397f1a76bb6 (Wiki-first Q&A and coding-agent navigation), 5f8a8fb5c4943eb0b9474f1a74efb9c0824f6226 (internal-link validation)
```

Kept/adapted:

- Wiki init/update/chat concepts.
- `wiki/` output and `.last-update.json` metadata.
- Git evidence collection, no-op update behavior, and interrupted-run retry metadata.
- Documentation quality, planning, privacy, update discipline, deferred-area backlog tracking, and post-run internal-link validation.
- Wiki-first question answering plus coding-agent-oriented task routing, symbol/test/validation guidance, and evidence-backed page relationships.
- User-owned persistent Wiki brief adapted from OpenWiki `openwiki/INSTRUCTIONS.md`.

Intentionally different:

- No OpenWiki CLI/Ink UI, credential flow, LangChain/DeepAgents runtime, SQLite checkpointer, or separate provider key.
- Pi slash commands and the current Pi model/tools perform the work.
- Harness owns the Wiki capability; there is no second `extensions/wiki/` entrypoint.
- Domain-local reviewed rules are Markdown prompts under `wiki/**/_rules.md`.
- Harness keeps its focused page budget/backlog model and English output contract; it does not adopt OpenWiki's OKF/index/visualizer pipeline, forced Mermaid generation, QA subagent graph, connectors, or personal-wiki features.
- OpenWiki's `.openwikiignore` backend gate cannot be copied safely onto Pi's shared filesystem tools; Harness continues to use the user-owned Wiki brief for scope exclusions and deterministic protection for reserved/sensitive paths.

## Upstream upgrade checklist

1. Fetch the latest `langchain-ai/openwiki` source and record the commit.
2. Compare prompt, agent workflow, command, git/update, and generated-doc changes against the base commit above.
3. Port only behavior relevant to the Pi-native Harness Wiki module.
4. Preserve Harness command names, prompt-rule ownership, lazy loading, metadata semantics, and Pi UI safety.
5. Update this provenance block and run runtime tests plus manual `/reload` verification.
