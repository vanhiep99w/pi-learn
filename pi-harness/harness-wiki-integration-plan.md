# Kế hoạch hợp nhất Harness Wiki và domain-local prompt rules

> Trạng thái: implementation đã hoàn thành trong source/docs/tests ngày 2026-07-10; còn manual verification trong một Pi TUI session sau `/reload` trước khi coi migration release-ready.
>
> Ngày ghi nhận ban đầu: 2026-07-10.
>
> Cập nhật thiết kế: 2026-07-10 — thay mô hình JSON detector/guidance rules bằng reviewed Markdown prompt rules được model tự load theo chỉ dẫn trong `AGENTS.md` và `wiki/quickstart.md`.
>
> Implementation checkpoint: một public Harness entrypoint, `/harness-wiki-*`, lazy prompt-rule loading, `_rules.md` discovery/lint/scaffold, proposal routing, transactional post-apply validation, path/snapshot/no-op semantics và eval/tests đã được triển khai. `npm --prefix packages/harness-runtime test` pass; actual print-mode `/harness-wiki-status` command pass. Interactive TUI `/reload` verification vẫn còn pending.
>
> Phạm vi tài liệu: hợp nhất Wiki extension vào Harness extension, đổi command sang `/harness-wiki-*`, và chuyển project-level Harness guidance sang một `_rules.md` cho root cùng mỗi section có ý nghĩa trong `wiki/`.

---

## 1. Mục tiêu

Thiết kế mới coi Wiki là một capability của Pi Harness thay vì một extension độc lập.

Mô hình sản phẩm mục tiêu:

```txt
Pi Harness
├── session observability
├── reports
├── reflection
├── proposals
├── controlled apply
├── eval/automation
└── wiki knowledge
    ├── repository documentation
    └── domain-local reviewed prompt rules
```

Các mục tiêu cụ thể:

1. Chỉ còn một public Pi extension entrypoint cho Harness.
2. Toàn bộ command Wiki dùng namespace `/harness-wiki-*`.
3. Xóa hoàn toàn command `/wiki-*`; không giữ alias tương thích.
4. Không tạo đường dẫn trung gian `wiki/harness/`.
5. Root và mỗi Wiki section có ý nghĩa có đúng một file `_rules.md` tương ứng.
6. `_rules.md` chứa prompt instructions/checklists dễ đọc, không chứa JSON detector config.
7. Prompt rules nằm cạnh domain mà chúng hướng dẫn thay vì gom trong `harness/rules/`.
8. Pi không tự động nhét toàn bộ rules vào system prompt. Model tự load root và section rules theo bootstrap instruction.
9. Rule improvement vẫn đi qua evidence → proposal → approval → apply → validation.
10. Deterministic detector code, security gates và apply safety vẫn nằm trong Harness runtime/extension, không dựa vào prompt compliance.
11. Raw session, normalized cache, reports, reflection prompts và draft proposals vẫn là dữ liệu private ngoài repository.

---

## 2. Các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Wiki extension | Không còn là extension độc lập; trở thành module trong Harness extension. |
| Public entrypoint | `packages/pi-learn-extensions/extensions/harness/index.ts`. |
| Command mới | `/harness-wiki-init`, `/harness-wiki-update`, `/harness-wiki-ask`, `/harness-wiki-status`. |
| Command cũ | Xóa `/wiki-init`, `/wiki-update`, `/wiki-ask`, `/wiki-status`. Không đăng ký alias deprecated. |
| Wiki output | Tiếp tục dùng `wiki/`. |
| Wiki metadata | Tiếp tục dùng `wiki/.last-update.json`. |
| Rule format | Markdown prompt instructions, basename chính xác `_rules.md`. |
| Rule layout | Root và mỗi Wiki section có một `_rules.md`. |
| Rule loading | Lazy/self-load: `AGENTS.md` → `wiki/quickstart.md` → root/section `_rules.md`. |
| Context injection | Không dùng `before_agent_start` để tự động append toàn bộ rules. Không prefix rules vào user prompt. |
| Rule refresh | Không watcher, không mtime/hash cache, không yêu cầu `/reload`; mỗi lần `read` nhận nội dung hiện tại trên đĩa. |
| Applicability | Áp dụng cho mọi Pi coding turn theo scope, thông qua bootstrap instruction và model tự chọn section. |
| Không dùng | Không dùng `wiki/**/_rules.json`, `wiki/harness/rules/`, hoặc một file cho mỗi rule. |
| Built-in detector code | Vẫn nằm trong `packages/harness-runtime/src/**`. Không chuyển detector implementation hoặc threshold vào Wiki prompt rules. |
| Reviewed project rules | Lưu dưới `wiki/**/_rules.md`. |
| Draft/evidence | Vẫn nằm trong `~/.pi/harness/`, không commit vào Wiki. |
| Apply safety | Human approval, target-file allowlist, git checks, tests/eval và rollback vẫn được giữ. |

Đây là breaking change có chủ đích. Tài liệu, prompt và command help sau migration chỉ nói về `/harness-wiki-*` và `_rules.md`.

---

## 3. Nguyên tắc tách prompt rules khỏi deterministic behavior

Thiết kế không trộn ba loại behavior vào cùng một schema:

### 3.1 Prompt rules

`wiki/**/_rules.md` phù hợp cho:

- Coding conventions.
- Quy trình đọc/sửa/test.
- Domain-specific constraints.
- UI lifecycle guidance.
- Documentation ownership.
- Review checklist.
- Cách chọn source of truth.

Đây là natural-language instructions dành cho model.

### 3.2 Deterministic detectors

Vẫn nằm trong runtime:

```txt
packages/harness-runtime/src/analysis/**
packages/harness-runtime/src/reflection/**
packages/harness-runtime/src/improve/**
packages/harness-runtime/src/eval/**
```

Bao gồm:

- Detector implementation.
- Threshold/defaults.
- Event grouping/fingerprinting.
- Parser/normalizer behavior.
- Proposal generation logic.
- Eval implementation.

Runtime không parse câu tự nhiên trong `_rules.md` để lấy `minOccurrences`, threshold hoặc detector params.

### 3.3 Deterministic safety gates

Vẫn phải được enforce bằng code:

- Chặn đọc secret/auth/payload logs khi workflow không cho phép.
- Chặn Wiki documentation turn sửa `_rules.md`.
- Chặn apply ngoài proposal `targetFiles`.
- Path traversal và symlink escape protection.
- Approval requirement.
- Clean-worktree/branch/rollback guarantees.
- Post-apply tests/eval.

Prompt rule là guidance, không phải security boundary.

### 3.4 Future detector configuration

Nếu sau này cần project-level detector tuning, dùng một config riêng có schema rõ ràng, ví dụ `harness.config.json` hoặc config tương đương. Không đặt config đó trong `_rules.md` và không gọi nó là Wiki prompt rule.

Detector configuration là non-goal của migration đầu tiên.

---

## 4. Hiện trạng trước migration

### 4.1 Extension hiện tại

Hai entrypoint đang tách riêng:

```txt
packages/pi-learn-extensions/extensions/
├── harness/
│   └── index.ts
└── wiki/
    ├── index.ts
    ├── prompt.ts
    └── README.md
```

Harness extension hiện đăng ký:

```txt
/harness-status
/harness-report
/harness-improve
/harness-proposals
/harness-apply
/harness-eval
/harness-mark
```

Wiki extension hiện đăng ký:

```txt
/wiki-init
/wiki-update
/wiki-ask
/wiki-status
```

### 4.2 Wiki prompt hiện tại không phải system prompt thật

`packages/pi-learn-extensions/extensions/wiki/prompt.ts` tạo một chuỗi có hàm tên `createSystemPrompt()`, nhưng `wiki/index.ts` gửi toàn bộ chuỗi bằng:

```ts
pi.sendUserMessage(createPiNativeWikiPrompt(...));
```

Vì vậy phần “system prompt” hiện tại thực tế là nội dung user message. Migration phải đổi wording/structure cho rõ, không tiếp tục gọi một đoạn user message là system prompt.

Thiết kế mới vẫn có thể gửi command-specific task prompt bằng `pi.sendUserMessage()`, nhưng prompt đó chỉ yêu cầu model đọc bootstrap/rules; nó không nhúng toàn bộ rule content.

### 4.3 Rule config hiện tại

Runtime hiện tìm project rule config trực tiếp tại:

```txt
<project>/harness/rules/*.json
```

Logic nằm tại:

```txt
packages/harness-runtime/src/analysis/rules.js
```

Một số proposal generator hiện target các path như:

```txt
harness/rules/edit-tool-failure.json
harness/rules/bash-failure-repeat.json
harness/rules/tool-error-repeat.json
```

Các target trên phải bị loại bỏ. Sau migration:

- Workflow/guidance improvement target section-level `_rules.md`.
- Detector implementation/default improvement target runtime source/tests.
- Không tạo JSON detector config trong Wiki.

### 4.4 Wiki path classification hiện tại

Wiki extension hiện coi mọi path dưới `wiki/` là Wiki content. Sau migration phải phân biệt:

- `wiki/**/*.md`, trừ reserved files: documentation content.
- `wiki/**/_rules.md`: reviewed prompt rules.
- `wiki/.last-update.json`: extension metadata.
- `wiki/_plan.md`: temporary planning file.

Phải kiểm tra rule path trước generic Markdown path vì `_rules.md` cũng là Markdown.

---

## 5. Kiến trúc extension sau migration

Cấu trúc mục tiêu tối thiểu:

```txt
packages/pi-learn-extensions/extensions/harness/
├── index.ts
├── wiki-commands.ts
├── wiki-prompt.ts
└── README.md
```

Vai trò:

| File | Trách nhiệm |
|---|---|
| `index.ts` | Public extension entrypoint; đăng ký Harness tool/commands/events và gọi module Wiki. |
| `wiki-commands.ts` | Orchestration cho init/update/ask/status, git context, no-op, snapshot, scaffold và metadata. |
| `wiki-prompt.ts` | Command-specific Harness Wiki task prompt; chỉ dẫn model tự đọc quickstart và applicable `_rules.md`. |
| `README.md` | Command reference, OpenWiki provenance, intentional differences và upgrade notes. |

Có thể tách thêm pure helper nếu file lớn, nhưng không tạo nested extension entrypoint thứ hai. Chỉ `harness/index.ts` export default extension factory.

### 5.1 Registration pattern

```ts
export default function harnessExtension(pi: ExtensionAPI) {
  registerHarnessTooling(pi);
  registerHarnessCommands(pi);
  registerHarnessWikiCommands(pi);
  registerHarnessEvents(pi);
}
```

Wiki module chỉ export register/helper functions.

### 5.2 Không thêm automatic prompt-rule injector

Migration đầu tiên không đăng ký handler kiểu:

```ts
pi.on("before_agent_start", ...appendEveryRule...);
```

Cũng không dùng `context` event để thêm transient rule messages trước mỗi provider request.

Lý do:

- Tránh context pollution.
- Giữ provider prompt prefix ổn định.
- Tránh duplicate rule content qua nhiều turns/tool loops.
- Không cần cache/invalidation lifecycle.
- Cho model đọc đúng domain thay vì nạp mọi section.

### 5.3 Xóa source cũ

Sau khi code đã chuyển và test:

```txt
packages/pi-learn-extensions/extensions/wiki/index.ts
packages/pi-learn-extensions/extensions/wiki/prompt.ts
packages/pi-learn-extensions/extensions/wiki/README.md
```

sẽ được xóa. Nội dung provenance/upgrade có giá trị phải được chuyển sang Harness README trước.

---

## 6. Command surface cuối cùng

### 6.1 Command được giữ

```txt
/harness-status [last]
/harness-report [last]
/harness-improve [last]
/harness-proposals
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note [text]
```

### 6.2 Harness Wiki commands

Chỉ đăng ký:

```txt
/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
/harness-wiki-status
```

### 6.3 Không có compatibility alias

Không đăng ký:

```txt
/wiki-init
/wiki-update
/wiki-ask
/wiki-status
```

Không dùng duplicate command, hidden alias hoặc deprecation notification.

### 6.4 Command reference trong prompt/docs

Mọi hard-coded reference `/wiki-*` phải đổi sang `/harness-wiki-*` trong:

- Harness Wiki task prompt.
- Extension README.
- Root/package/runtime README.
- Wiki pages.
- Startup/status text.
- Tests/fixtures/snapshots.

---

## 7. Cấu trúc Wiki và prompt rules

Cấu trúc mục tiêu cho repository hiện tại:

```txt
wiki/
├── _rules.md
├── .last-update.json
├── quickstart.md
├── architecture/
│   ├── _rules.md
│   ├── overview.md
│   └── harness-runtime.md
├── extensions/
│   ├── _rules.md
│   ├── catalog.md
│   └── wiki-extension.md
└── operations/
    ├── _rules.md
    ├── development.md
    └── testing-and-safety.md
```

Không dùng:

```txt
wiki/**/_rules.json
wiki/harness/rules/*.json
wiki/rules/*.json
harness/rules/*.json
```

### 7.1 Định nghĩa Wiki section

Một directory được coi là Wiki section nếu:

1. Nằm dưới `wiki/`.
2. Không phải hidden/system/temp directory.
3. Chứa ít nhất một final Markdown documentation page của một domain.
4. Không chỉ tồn tại để chứa asset.

Root `wiki/` luôn là global section.

Ví dụ section:

```txt
wiki/
wiki/architecture/
wiki/extensions/
wiki/operations/
```

Ví dụ không bắt buộc có `_rules.md`:

```txt
wiki/.cache/
wiki/assets/
wiki/_tmp/
```

### 7.2 Một file cho mỗi section

Mỗi section có đúng một reserved prompt-rule file:

```txt
_rules.md
```

Một file chứa các prompt rules của section. Không tạo một file cho từng rule.

Lợi ích:

- Rules nằm cạnh domain documentation.
- Model và reviewer đọc được trực tiếp.
- Không cần JSON-to-prompt transformation.
- Dễ review toàn bộ policy của một domain.
- Proposal target có path ổn định.
- Giảm số lượng file nhỏ.

---

## 8. Prompt rule format

### 8.1 Không có JSON schema hoặc frontmatter bắt buộc

`_rules.md` là Markdown tự nhiên. Không yêu cầu các field:

```txt
schemaVersion
kind
enabled
params
sourceGlobs
instruction
checks
```

Không parse natural-language prompt để điều khiển detector runtime.

### 8.2 Cấu trúc khuyến nghị

```md
# Pi extension rules

Apply these instructions when working with Pi extensions, themes, or
package extension loading.

Relevant source areas include:

- `packages/pi-learn-extensions/extensions/**`
- `packages/pi-learn-extensions/themes/**`
- `packages/pi-learn-extensions/package.json`

## EXT-UI-001 — Guard interactive UI operations

Guard interactive Pi UI operations with `ctx.hasUI`.

Requirements:

- Check `ctx.hasUI` before dialogs, editors, or selectors.
- Use optional UI access for best-effort notifications and cleanup.
- Dispose timers, listeners, and compositor state on shutdown.
- Do not reuse stale UI context after session replacement.

Origin proposal: `P-0012`
```

### 8.3 Stable rule ID

Rule heading nên dùng:

```txt
## <RULE-ID> — <short title>
```

ID pattern khuyến nghị:

```txt
[A-Z][A-Z0-9-]{2,63}
```

Ví dụ:

```txt
GLOBAL-EDIT-001
EXT-UI-001
OPS-TEST-001
ARCH-PARSER-001
```

Stable ID phục vụ review, proposal origin, lint và discussion; nó không biến Markdown thành detector config.

### 8.4 Origin proposal

Reviewed rule nên có:

```md
Origin proposal: `P-0012`
```

Không đưa evidence excerpt, raw session path hoặc private storage path vào committed rule.

### 8.5 Rule applicability

Đầu file mô tả bằng prose/source path examples khi section áp dụng. Đây là guidance cho model, không phải machine-evaluated `sourceGlobs`.

Quickstart/root rule index cung cấp high-level routing. Model quyết định section phù hợp dựa trên task và target files.

### 8.6 Không có enabled/disabled state

Prompt rule được coi là active khi nó tồn tại trong `_rules.md` và thuộc scope model đã load.

Muốn disable/remove/rewrite rule phải tạo proposal và patch Markdown. Audit history nằm trong Harness private history và Git, không cần `enabled: false`.

---

## 9. Rule loading vào Pi context

### 9.1 Bootstrap chain

```txt
Pi system context
  → tự động nạp top-level AGENTS.md
  → AGENTS.md yêu cầu đọc wiki/quickstart.md
  → quickstart chỉ tới wiki/_rules.md
  → model đọc global rules
  → model xác định domain/target files
  → model đọc applicable section _rules.md
  → model thực hiện task
```

### 9.2 Rules đi vào context bằng tool result

Model dùng `read` để đọc `_rules.md`. Nội dung rule đi vào conversation context như tool result.

Không có extension-side full-rule injection vào:

- System prompt.
- User prompt prefix.
- Persistent custom session messages.
- Provider payload rewrite.

Bootstrap requirement nằm trong `AGENTS.md`, là context file Pi tự load.

### 9.3 Mọi Pi turn có scope

Rules được thiết kế để áp dụng cho mọi coding turn, không chỉ Harness Wiki commands. Cơ chế là behavioral contract:

1. Đọc quickstart.
2. Đọc root rules.
3. Xác định target domains.
4. Đọc mọi matching section rules.
5. Re-read khi task scope thay đổi.

Đây là best-effort model discipline, không phải deterministic proof rằng model đã đọc file.

### 9.4 Multiple domains

Nếu task chạm nhiều domain, model đọc tất cả applicable files.

Ví dụ:

```txt
packages/harness-runtime/src/**
packages/pi-learn-extensions/extensions/**
```

thì đọc:

```txt
wiki/_rules.md
wiki/architecture/_rules.md
wiki/extensions/_rules.md
```

Nếu rules xung đột, model phải dừng và báo conflict thay vì tự chọn sibling theo thứ tự filesystem.

### 9.5 Rules sau compaction

Tool results cũ có thể bị tóm tắt hoặc rơi khỏi active context sau compaction. `AGENTS.md` vẫn là bootstrap source nên model phải re-read rules trước lần chỉnh sửa tiếp theo.

Không persist full rule content bằng `pi.appendEntry()` hoặc `pi.sendMessage()`.

### 9.6 Rule refresh

Không watcher, cache, mtime tracking hoặc hash invalidation.

```txt
_rules.md thay đổi
  → model read ở task/phase tiếp theo
  → nội dung mới đi vào context
```

Không cần `/reload` chỉ để đọc rule content mới. `/reload` vẫn cần khi extension source thay đổi.

Nếu rules có thể đã thay đổi trong cùng agent run, bootstrap yêu cầu model re-read trước khi tiếp tục edit.

### 9.7 Trade-off được chấp nhận

Lazy loading giảm context usage nhưng model có thể:

- Quên đọc quickstart/rules.
- Chọn thiếu section.
- Đọc rule quá muộn.
- Không phát hiện task đổi scope.

Mitigation:

- Bootstrap ngắn, rõ trong `AGENTS.md`.
- Rule-loading section nổi bật trong quickstart.
- Root rules yêu cầu đọc section trước edit.
- Harness Wiki task prompt nhắc lại quy trình.
- Deterministic safety vẫn enforce bằng code.
- Evals kiểm tra compliance với representative tasks.

---

## 10. Bootstrap trong `AGENTS.md`

Pi tự động nạp `AGENTS.md`, nhưng không tự động nạp `wiki/quickstart.md` hoặc mọi `_rules.md`.

Top-level `AGENTS.md`/`CLAUDE.md` Wiki reference phải chứa semantic contract tương đương:

```md
## Harness Wiki

This repository has documentation under `wiki/`.

Before modifying repository files:

1. Read `wiki/quickstart.md`.
2. Follow its “Rule loading” instructions.
3. Read `wiki/_rules.md`.
4. Read every section `_rules.md` applicable to the target files.
5. Re-read applicable rules when the task scope changes.

Do not modify `wiki/**/_rules.md` outside the approved Harness
proposal and apply workflow.
```

Không bắt buộc byte-for-byte giống template, nhưng không được làm mất các semantics trên.

Critical safety/bootstrap instructions vẫn có thể nằm trực tiếp trong `AGENTS.md`. Không chuyển mọi instruction khỏi `AGENTS.md` chỉ vì có Wiki rules.

---

## 11. Rule-loading section trong `wiki/quickstart.md`

Quickstart phải có section dễ tìm, ví dụ:

```md
## Rule loading

Harness rules are reviewed prompt instructions stored alongside each
Wiki domain.

Before modifying repository files:

1. Read [`wiki/_rules.md`](_rules.md) for global rules.
2. Determine which source domains the target files belong to.
3. Read the corresponding section `_rules.md` files.
4. If files belong to multiple domains, read all matching rule files.
5. Read rules before editing, not after an edit fails.

Available rule sections:

| Domain | Rule file |
| --- | --- |
| Global repository behavior | [`wiki/_rules.md`](_rules.md) |
| Harness runtime and architecture | [`wiki/architecture/_rules.md`](architecture/_rules.md) |
| Pi extensions and themes | [`wiki/extensions/_rules.md`](extensions/_rules.md) |
| Tests, docs, releases and operations | [`wiki/operations/_rules.md`](operations/_rules.md) |
```

### 11.1 Ownership của quickstart rule index

`quickstart.md` vẫn là documentation do Harness Wiki workflow quản lý, nhưng “Rule loading” section có semantic contract ổn định:

- Được cập nhật links khi section thực sự thêm/xóa/đổi tên.
- Không chứa actual domain rule content.
- Không silently thay đổi ownership hoặc proposal requirement.
- Không bỏ root rule link.
- Không chuyển thành auto-injection claim.

Actual reviewed prompt rules chỉ nằm trong `_rules.md`.

---

## 12. Mapping đề xuất cho Wiki hiện tại

### 12.1 Root

```txt
wiki/_rules.md
```

Phạm vi:

```txt
global project safety
global edit workflow
global source-of-truth guidance
global Wiki maintenance constraints
cross-domain conflict behavior
```

### 12.2 Architecture

```txt
wiki/architecture/_rules.md
```

Relevant source areas:

```txt
packages/harness-runtime/src/**
packages/harness-runtime/tests/**
packages/harness-runtime/package.json
pi-harness/**
```

Prompt rules phù hợp:

- Parser/normalizer invariants.
- Cache/storage boundaries.
- Redaction boundary.
- Proposal lifecycle architecture.
- Runtime test requirements.

### 12.3 Extensions

```txt
wiki/extensions/_rules.md
```

Relevant source areas:

```txt
packages/pi-learn-extensions/extensions/**
packages/pi-learn-extensions/themes/**
packages/pi-learn-extensions/package.json
```

Prompt rules phù hợp:

- `ctx.hasUI` và optional UI access.
- Cleanup timers/listeners/compositor.
- Pi command naming.
- TypeBox schema/tool descriptions.
- Package extension loading boundaries.

### 12.4 Operations

```txt
wiki/operations/_rules.md
```

Relevant source areas:

```txt
package.json
package-lock.json
README.md
docs/**
.github/**
```

Prompt rules phù hợp:

- Test/reload workflow.
- Git status/diff hygiene.
- Release/version synchronization.
- Documentation indexing.
- Repeated bash failure workflow guidance.

---

## 13. Rule ownership

```txt
wiki/**/*.md, trừ reserved prompt-rule/temp paths
  owner: Harness Wiki documentation workflow

wiki/**/_rules.md
  owner: Harness proposal + approval + controlled apply lifecycle

wiki/.last-update.json
  owner: Harness Wiki metadata finalizer

wiki/_plan.md
  owner: temporary Harness Wiki run; phải xóa trước khi kết thúc
```

### 13.1 Coding/Wiki agent được phép

- Đọc quickstart và applicable `_rules.md`.
- Dùng prompt rules làm constraints/checklists.
- Cập nhật normal Wiki Markdown trong command mode phù hợp.
- Nêu nhu cầu rule improvement nếu evidence đủ mạnh.
- Tạo proposal qua Harness workflow khi được yêu cầu.

### 13.2 Coding/Wiki agent không được phép

- Tự thêm/sửa/xóa rule trong `_rules.md` trong normal coding/documentation turn.
- Tự ghi `Origin proposal` giả.
- Tự sửa `.last-update.json`.
- Đưa normalized/private evidence excerpt vào committed rule file.
- Coi prompt rule như detector threshold config.

### 13.3 Actual rule changes

```txt
normalized evidence
  → deterministic/LLM proposal
  → /harness-proposals (user review + approve/reject/approve&apply)
  → /harness-apply P-xxxx
  → Markdown/path lint
  → relevant tests/eval
  → commit hoặc rollback
```

---

## 14. Bootstrap `_rules.md`

Có một ngoại lệ cần thiết: deterministic metadata-only/prompt-empty scaffold cho section mới.

### 14.1 Root scaffold

`/harness-wiki-init` bảo đảm tồn tại:

```txt
wiki/_rules.md
```

Nếu chưa có, extension có thể tạo deterministic scaffold:

```md
# Global Harness rules

These reviewed prompt rules apply to all repository tasks.

Before modifying files, read every section `_rules.md` relevant to the
target files. If rules conflict, stop and report the conflict.

No reviewed global rules have been added yet.
```

### 14.2 Section scaffold

Sau documentation turn, extension scan final Wiki sections. Section thiếu `_rules.md` có thể nhận scaffold:

```md
# Extensions rules

These reviewed prompt rules apply to the `wiki/extensions/` domain.

No reviewed domain-specific rules have been added yet.
```

Scaffold:

- Không chứa invented policy.
- Không chứa source mapping chưa review.
- Không có fake proposal origin.
- Không được tính là documentation update.

### 14.3 Source-area mapping sau bootstrap

Initial repository migration có thể thêm reviewed “Relevant source areas” prose cùng code change này.

Project mới có thể dùng proposal để thêm/refine source-area descriptions sau khi Wiki được tạo. Không để Wiki documentation model silently invent policy scope rồi coi nó là reviewed rule.

### 14.4 Quickstart index maintenance

Sau scaffold, quickstart Rule loading table phải link tới final section rule files. Link/index update là documentation navigation; actual `_rules.md` content vẫn proposal-owned.

---

## 15. Lightweight prompt-rule validation

Không có JSON schema registry. Chỉ cần path/content lint phục vụ safety và status.

### 15.1 Path validation

- Rule file phải nằm trong project root.
- Basename chính xác `_rules.md`.
- Không follow symlink trỏ ra ngoài project root.
- Normalize repository-relative POSIX path.
- Không chấp nhận alternate names như `_rules.json`, `rules.md` hoặc per-rule JSON.

### 15.2 Content validation

MVP lint:

- UTF-8 text đọc được.
- Không có NUL bytes.
- File không vượt 64 KiB.
- Root `_rules.md` tồn tại.
- Mỗi final Wiki section có tối đa/đúng một `_rules.md` theo contract.
- Markdown heading không bị hỏng rõ ràng.
- Rule IDs theo heading convention, nếu có, phải hợp lệ.
- Không duplicate rule ID trong cùng file.
- Có thể cảnh báo duplicate ID toàn project; không tự merge/override.
- `Origin proposal` nếu có phải dùng proposal ID syntax hợp lệ.

Không cố validate semantic truth của natural-language prompt bằng parser.

### 15.3 Size discipline

Đề xuất:

```txt
max file size: 64 KiB
recommended max rules per section: 100
recommended rule body: <= 2,000 chars
recommended total loaded rules per task: chỉ root + matching sections
```

Đây là lint/warning limits, không phải model context injection budget vì extension không tự load full files.

### 15.4 Invalid rules policy

- `/harness-wiki-status` luôn chạy và hiển thị lint/path errors.
- Controlled apply vào `_rules.md` fail closed nếu path/content lint fail.
- Wiki documentation commands không sửa invalid rule files.
- Read-only report/scan vẫn có thể chạy với warning.
- Không silently rename hoặc rewrite malformed rule files.

---

## 16. Prompt rule discovery cho status/protection

Harness chỉ cần discover reserved files bằng pattern:

```txt
wiki/**/_rules.md
```

Discovery dùng cho:

- Ownership protection.
- Status/lint.
- Scaffold completeness.
- Proposal target validation.
- Tests/eval.

Discovery không build “effective rule registry” và không tự inject content vào model context.

Deterministic order cho output/status:

```txt
wiki/_rules.md
wiki/architecture/_rules.md
wiki/extensions/_rules.md
wiki/operations/_rules.md
```

Không scan:

```txt
node_modules/**
.git/**
wiki/.*/**
wiki/_tmp/**
```

---

## 17. Rule interaction và precedence

Vì model tự load Markdown, precedence là instruction contract thay vì runtime merge algorithm:

```txt
critical AGENTS.md safety/bootstrap
  > wiki/_rules.md global rules
  > applicable section _rules.md specialization
  > explicit user request, nếu không vi phạm higher-priority safety/ownership
```

Nguyên tắc:

- Global và section rules có ID khác nhau cùng áp dụng.
- Section có thể specialize global guidance, nhưng không silently vô hiệu hóa critical safety.
- Hai sibling sections conflict thì model phải dừng và báo.
- Không dùng filesystem order để chọn một rule.
- Muốn override/remove rule phải proposal patch explicit cả conflict và intended scope.

Không hỗ trợ hidden `enabled: false` hoặc same-ID JSON override semantics.

---

## 18. Rule improvement lifecycle theo section

### 18.1 Proposal target selection

Khi target là `rules`, Harness chọn một existing section file:

```txt
wiki/_rules.md
wiki/architecture/_rules.md
wiki/extensions/_rules.md
wiki/operations/_rules.md
```

Routing guide:

1. Lấy proposal `targetFiles` hoặc evidence source paths.
2. Đọc domain map trong quickstart/root rules và section descriptions.
3. Nếu một section là best match rõ ràng, target `_rules.md` của section đó.
4. Nếu cross-cutting hoặc ambiguous, target `wiki/_rules.md` và ghi rõ scope cần human review.
5. Không tự tạo arbitrary nested section chỉ để chứa rule.

Routing có thể do reflection model đề xuất; deterministic importer chỉ validate target path/allowlist/existing section.

### 18.2 Ví dụ routing

Repeated exact-edit mismatch dùng chung repo:

```txt
target: wiki/_rules.md
```

Parser workflow guidance:

```txt
target: wiki/architecture/_rules.md
```

Unsafe Pi extension UI workflow:

```txt
target: wiki/extensions/_rules.md
```

Release/test workflow:

```txt
target: wiki/operations/_rules.md
```

Detector implementation/threshold change:

```txt
target: packages/harness-runtime/src/analysis/**
        + relevant tests
```

Không target `_rules.md` nếu thay đổi cần executable deterministic behavior.

### 18.3 Proposal fields

Rule proposal vẫn phải có:

```txt
title
target=rules
targetFiles
evidence refs
risk
problem
proposed change
test plan
rollback plan
machine-applicable patch
```

Thêm target-specific details:

```txt
section
rule ID
rule title
prompt instruction/checklist
expected scope
conflict/false-guidance risk
origin proposal ID
```

### 18.4 Markdown patch

Machine-applicable patch sửa exact Markdown block trong target-listed `_rules.md`.

Apply không được:

- Patch file section khác.
- Tạo JSON config.
- Ghi private evidence.
- Sửa quickstart/docs ngoài proposal target allowlist.

### 18.5 Apply validation

Sau apply nhưng trước commit:

1. Re-read changed `_rules.md`.
2. Validate path/content/size/ID lint.
3. Verify patch chỉ chạm target-listed files.
4. Run prompt-rule protection/routing evals.
5. Run relevant runtime tests nếu proposal cũng đổi code.
6. Nếu fail, không commit và cung cấp rollback.

---

## 19. Built-in detectors và prompt rules

### 19.1 Giữ trong runtime

```txt
packages/harness-runtime/src/analysis/rules.js
packages/harness-runtime/src/improve/target-proposals.js
packages/harness-runtime/src/reflection/reflection.js
packages/harness-runtime/src/eval/eval-harness.js
packages/harness-runtime/tests/**
```

### 19.2 Chuyển sang Wiki

Chỉ reviewed prompt artifacts:

- Domain-local coding guidance.
- Workflow/checklists.
- Source-of-truth instructions.
- Rule-loading/routing prose.
- Non-sensitive proposal origin metadata.

### 19.3 Không chuyển

- Detector implementation/defaults/thresholds.
- Raw session logs.
- Normalized events/warnings.
- Private evidence excerpts.
- Draft proposals/history.
- Eval reports chứa session evidence.
- Auth/settings/secrets.

---

## 20. Private storage không thay đổi

```txt
~/.pi/harness/projects/<project-key>/
├── sessions/<session-id>/
│   ├── manifest.json
│   ├── events.jsonl
│   ├── metrics.json
│   └── warnings.jsonl
├── reports/
├── reflections/
├── proposals/draft/
├── proposals/history.jsonl
├── memory/
└── evals/
```

Committed prompt rule chỉ nên tham chiếu:

```md
Origin proposal: `P-0012`
```

Không copy evidence excerpt hoặc absolute private paths vào `_rules.md`.

---

## 21. Harness Wiki task prompt changes

Prompt mới tự nhận diện là Harness Wiki:

```txt
You are Harness Wiki, the repository-knowledge capability of Pi Harness.
```

### 21.1 Command-specific prompt rules

Task prompt phải nói rõ:

- Dùng current Pi provider/model/tools.
- Ground claims in inspected source/docs/git evidence.
- Đọc `wiki/quickstart.md`.
- Đọc `wiki/_rules.md` trước khi sửa.
- Đọc every applicable section `_rules.md` trước khi sửa section/source domain.
- Nếu task scope thay đổi, re-read applicable rules.
- Không sửa `_rules.md` trong Wiki documentation turn.
- Không sửa `.last-update.json`.
- Nếu cần rule improvement, chỉ mô tả hoặc tạo Harness proposal khi workflow yêu cầu.
- Không đọc secrets/raw sessions/payload logs.

### 21.2 Không nhúng full rules vào command prompt

Command handler gửi concise task prompt bằng `pi.sendUserMessage()`. Prompt có pointer, không copy full `_rules.md` content.

Ví dụ flow:

```txt
/harness-wiki-update
  → extension tạo git/update context
  → gửi user task prompt
  → model đọc quickstart/root/section rules bằng read
  → model cập nhật normal Wiki docs
```

### 21.3 Ask mode

`/harness-wiki-ask`:

- Đọc quickstart và rules liên quan đến câu hỏi.
- Trả lời trực tiếp.
- Không sửa docs/rules trừ khi user yêu cầu rõ và workflow cho phép.
- Nếu user hỏi policy, cite rule file/path phù hợp.

---

## 22. Snapshot và metadata semantics

### 22.1 Path helpers

```txt
isWikiRulePath(path)
isWikiMetadataPath(path)
isWikiTemporaryPath(path)
isWikiDocumentationPath(path)
```

Classification order:

```txt
wiki/**/_rules.md          → reviewed prompt rules
wiki/.last-update.json     → metadata
wiki/_plan.md              → temporary
wiki/**/*.md               → documentation
```

### 22.2 Documentation snapshot

Bao gồm:

```txt
wiki/**/*.md
```

Loại trừ:

```txt
wiki/**/_rules.md
wiki/.last-update.json
wiki/_plan.md
hidden/temp files
```

Lý do loại `_rules.md`:

- Rule apply không phải documentation generation.
- Không ghi `.last-update.json` chỉ vì proposal vừa chỉnh prompt policy.
- Metadata Wiki phản ánh docs update, không phản ánh mọi Harness policy change.

### 22.3 Metadata writer

Sau `/harness-wiki-init` hoặc `/harness-wiki-update`:

- Nếu documentation Markdown snapshot thay đổi, ghi `.last-update.json`.
- Nếu chỉ deterministic `_rules.md` scaffold được tạo, không coi là docs update.
- Agent/model không tự ghi metadata.

---

## 23. No-op update semantics

### 23.1 Docs-only changes

Nếu HEAD chỉ thay đổi:

```txt
normal wiki documentation Markdown
wiki/.last-update.json
```

thì update có thể skip theo existing contract.

### 23.2 Prompt-rule changes

Nếu HEAD hoặc working tree thay đổi:

```txt
wiki/**/_rules.md
```

thì update không được skip chỉ vì path nằm dưới `wiki/`.

Rule change là meaningful policy change vì documentation có thể cần phản ánh workflow/ownership mới.

### 23.3 Suggested predicate

```txt
if no previous gitHead:
  run

if working tree has changes excluding metadata:
  run

if HEAD unchanged:
  skip

changed paths since previous gitHead:
  if any path is a Wiki rule path:
    run
  if any path is outside Wiki documentation/metadata:
    run
  otherwise:
    skip
```

Rule-only run có thể kết thúc no-op nếu normal docs vẫn đúng. Khi docs không đổi, không update metadata.

---

## 24. `/harness-wiki-status` output

Status hợp nhất Wiki health và prompt-rule file health, nhưng không claim model đã load rules.

Ví dụ:

```txt
Harness Wiki status
- cwd: /repo
- docs: wiki/ exists
- git head: <sha>
- docs snapshot: <sha256>
- last update: {...}
- update no-op: no (prompt rules changed)
- prompt rule files: 4
- root rule file: present
- sections missing rules: 0
- prompt rule lint: valid

Rule files
- root: wiki/_rules.md
- architecture: wiki/architecture/_rules.md
- extensions: wiki/extensions/_rules.md
- operations: wiki/operations/_rules.md
```

Nếu invalid:

```txt
- prompt rule lint: invalid
- wiki/extensions/_rules.md: duplicate rule id EXT-UI-001
```

Status không in private evidence/raw session paths và không hiển thị “active rules in current context” vì extension không theo dõi model đã `read` file nào.

---

## 25. Runtime implementation changes

### 25.1 Prompt-rule file helpers

Có thể thêm pure helper, ví dụ:

```txt
packages/harness-runtime/src/analysis/wiki-prompt-rules.js
```

hoặc đặt helper phù hợp trong Harness extension nếu runtime không cần dùng chung.

Trách nhiệm giới hạn:

```txt
discoverWikiRuleFiles(project)
lintWikiRuleFile(path)
listWikiSections(project)
findRuleTargetCandidates({ project, targetFiles })
```

Module không:

- Build effective detector registry.
- Parse natural language thành executable params.
- Inject rules vào Pi system prompt.
- Track context-loaded state.

### 25.2 `analysis/rules.js`

Cần đổi:

- Không đọc `<project>/harness/rules/*.json`.
- Giữ built-in deterministic detector defaults trong runtime.
- Không load detector config từ `_rules.md`.
- Surface proposal guidance khi warning nên dẫn tới prompt rule hoặc runtime implementation change.

### 25.3 `improve/target-proposals.js`

Đổi proposal targets:

```txt
harness/rules/edit-tool-failure.json
  → wiki/_rules.md hoặc selected section/_rules.md

harness/rules/bash-failure-repeat.json
  → wiki/operations/_rules.md cho workflow guidance
  hoặc runtime analysis source cho detector implementation
```

Test plan text không được nhắc command không tồn tại như `/harness-propose` nếu extension không đăng ký command đó.

### 25.4 `reflection/reflection.js`

Routing guide đổi thành:

```txt
rules → wiki/**/_rules.md for reviewed project prompt guidance,
        or packages/harness-runtime/src/analysis/** for deterministic behavior
```

Importer normalization nhận `_rules.md` là valid `target=rules` khi path là root/existing Wiki section rule file.

### 25.5 Proposal lifecycle

Controlled apply phải:

- Cho phép target `wiki/**/_rules.md` nếu proposal allowlist chứa chính xác path đó.
- Không cho patch sang section khác.
- Lint changed rule files sau apply.
- Chạy relevant eval/tests.
- Không commit khi validation fail.
- Giữ clean-worktree/branch/history/rollback guarantees.

---

## 26. Extension UI safety trong lúc merge

Chuẩn hóa Wiki code theo Pi safety rules:

- Guard dialogs/editors/selectors bằng `ctx.hasUI`.
- Dùng `ctx.ui?.notify`, `ctx.ui?.setStatus` cho best-effort UI.
- Có console/text fallback ở print/JSON mode khi phù hợp.
- Không để metadata finalizer crash nếu session UI đã thay đổi.
- Clear `harness-wiki` status trong `finally`.
- Reset pending Wiki run trong `session_shutdown` hoặc session replacement.

Status key:

```txt
harness-wiki
```

Không dùng generic `wiki` key sau merge.

---

## 27. Migration policy

### 27.1 Command migration

Before:

```txt
/wiki-init
/wiki-update
/wiki-ask
/wiki-status
```

After:

```txt
/harness-wiki-init
/harness-wiki-update
/harness-wiki-ask
/harness-wiki-status
```

Không có compatibility period.

### 27.2 Source migration

```txt
extensions/wiki/index.ts
  → extensions/harness/wiki-commands.ts

extensions/wiki/prompt.ts
  → extensions/harness/wiki-prompt.ts

extensions/wiki/README.md
  → merge relevant content into extensions/harness/README.md
```

### 27.3 Rule data migration

Old files nếu có:

```txt
harness/rules/*.json
```

không được blindly rename thành `_rules.md`.

Migration reviewed:

1. Discover old JSON files.
2. Phân loại nội dung.
3. Nếu là workflow guidance, viết lại thành prompt rule trong section `_rules.md` phù hợp.
4. Nếu là detector config/threshold, chuyển thành runtime code/config decision riêng; không dịch sang natural-language executable config.
5. Preserve useful stable identifiers khi phù hợp.
6. Không copy evidence/private paths.
7. Run tests/evals.
8. Xóa old files trong cùng reviewed migration patch.

Repo hiện tại không có committed `harness/rules/`, nên migration ban đầu chủ yếu đổi loader/proposal targets và future behavior.

### 27.4 Không legacy fallback

Steady state không đọc:

```txt
harness/rules/*.json
wiki/**/_rules.json
```

Canonical prompt rules chỉ là:

```txt
wiki/**/_rules.md
```

---

## 28. Documentation changes khi triển khai

Ít nhất rà soát:

```txt
AGENTS.md
README.md
packages/pi-learn-extensions/README.md
packages/pi-learn-extensions/extensions/harness/README.md
packages/harness-runtime/README.md
pi-harness/runtime-and-improvement.md
pi-harness/improvement-matrix.md
pi-harness/config.md
pi-harness/roadmap.md
wiki/quickstart.md
wiki/architecture/overview.md
wiki/architecture/harness-runtime.md
wiki/extensions/catalog.md
wiki/extensions/wiki-extension.md
wiki/operations/testing-and-safety.md
```

Mọi contract về command, path, ownership, lazy loading và proposal targets phải nhất quán.

Tên `wiki/extensions/wiki-extension.md` có thể giữ nếu trang mô tả capability, hoặc đổi trong docs migration có link updates đầy đủ.

---

## 29. Test plan

### 29.1 Prompt-rule helper tests

Thêm test cho:

- Discover root/nested `_rules.md` theo stable order.
- Root file missing.
- Final section missing `_rules.md`.
- Ignore hidden/assets/temp directories.
- Reject symlink escape.
- UTF-8/NUL/file-size handling.
- Valid rule heading IDs.
- Duplicate ID trong một file.
- Duplicate ID project warning.
- Valid scaffold không có invented rule.
- Không discover `_rules.json` như prompt rule.

### 29.2 Rule engine tests

Update `packages/harness-runtime/tests/rules.test.js`:

- Built-in detectors hoạt động không cần Wiki config.
- Runtime không đọc `harness/rules/*.json`.
- Runtime không parse `_rules.md` thành detector params.
- Existing deterministic warnings vẫn ổn định.

### 29.3 Target proposal tests

Update `packages/harness-runtime/tests/target-proposals.test.js`:

- Edit workflow guidance routes to root/selected `_rules.md`.
- Parser deterministic change routes to runtime source/tests.
- Extension guidance routes to `wiki/extensions/_rules.md`.
- Operations guidance routes to `wiki/operations/_rules.md`.
- No proposal targets `harness/rules/*.json` hoặc `_rules.json`.
- Ambiguous/cross-cutting guidance routes root và flags scope review.

### 29.4 Reflection tests

Update `packages/harness-runtime/tests/reflection.test.js`:

- Routing guide dùng `wiki/**/_rules.md`.
- `_rules.md` target normalize thành `rules`.
- Detector implementation target vẫn là runtime code.
- AGENTS-only changes vẫn normalize thành `agents`.
- Evidence ở private proposal, không nằm trong committed Markdown patch.

### 29.5 Proposal lifecycle tests

Update `packages/harness-runtime/tests/proposal-lifecycle.test.js`:

- Approved patch update listed `_rules.md`.
- Patch không update section khác.
- Invalid path/content/duplicate ID ngăn commit.
- Rollback restore previous Markdown.
- Normal Wiki turn cannot edit `_rules.md`.

### 29.6 Harness Wiki helper tests

- Rule path classification chạy trước documentation classification.
- Snapshot includes normal Markdown only.
- Snapshot excludes `_rules.md`, metadata và `_plan.md`.
- Rule-only Git change prevents docs-only no-op skip.
- Docs-only Git change may skip.
- Metadata-only change không trigger update.
- Section scaffolding tạo một `_rules.md` cho final sections.
- Không scaffold assets/temp directories.
- Scaffold-only change không update metadata.
- Quickstart Rule loading links resolve.

### 29.7 Bootstrap/context tests

Verify generated/task prompt semantics:

- Top-level `AGENTS.md` Wiki section yêu cầu đọc quickstart/root/applicable section rules.
- `wiki/quickstart.md` có Rule loading section và root link.
- Harness Wiki prompts nhắc model tự `read`, không embed full rule content.
- Không có `before_agent_start` automatic full-rule injection.
- Không có `context` handler duplicate rules.
- Không claim rules tự reload; docs nói mỗi `read` lấy current file content.

### 29.8 Command registration

Expected present:

```txt
harness-wiki-init
harness-wiki-update
harness-wiki-ask
harness-wiki-status
```

Expected absent:

```txt
wiki-init
wiki-update
wiki-ask
wiki-status
```

### 29.9 Runtime command

```bash
npm --prefix packages/harness-runtime test
```

### 29.10 Manual Pi verification

```txt
/reload
/harness-status
/harness-wiki-status
/harness-wiki-ask Prompt rules được load vào context thế nào?
/harness-wiki-update
/harness-wiki-update kiểm tra rule links và chỉ cập nhật docs liên quan
```

Kiểm tra thêm:

- `/wiki-status` không còn autocomplete.
- Model đọc quickstart → root → applicable section rules.
- Rule content không tự xuất hiện trong system prompt từ extension.
- Sửa `_rules.md` không cần `/reload` để tool `read` thấy nội dung mới.
- Rule-only change làm update được xem xét.
- Wiki update không sửa `_rules.md`.
- Metadata chỉ cập nhật khi normal documentation Markdown thay đổi.

---

## 30. Eval scenarios

Giữ:

```txt
redaction-fixture
parser-unknown-entry
edit-oldText-workflow
file-protection
smart-commit-basic
ts-extension-safety
```

Thêm/update:

```txt
wiki-prompt-rule-file-protection
wiki-prompt-rule-section-routing
wiki-prompt-rule-lazy-loading
harness-wiki-command-surface
```

### 30.1 `wiki-prompt-rule-file-protection`

Expected:

- Harness Wiki documentation prompt không sửa `_rules.md`.
- Approved, target-listed proposal apply có thể sửa.
- Tool/runtime gate block unauthorized write ngay cả khi model bỏ qua prompt.

### 30.2 `wiki-prompt-rule-section-routing`

Expected:

- Extension task đọc `wiki/_rules.md` và `wiki/extensions/_rules.md`.
- Runtime/parser task đọc architecture rules.
- Cross-domain task đọc mọi applicable section.
- Conflict được report, không silent filesystem-order choice.

### 30.3 `wiki-prompt-rule-lazy-loading`

Expected:

- `AGENTS.md` chỉ tới quickstart.
- Quickstart chỉ tới root/section rule files.
- Model dùng read để load rules trước edit.
- Extension không inject full rule files vào system/user prompt.
- Sau task scope change, model đọc thêm section rule phù hợp.

### 30.4 `harness-wiki-command-surface`

Expected:

- Chỉ `/harness-wiki-*` được đăng ký.
- Không có `/wiki-*` alias.

---

## 31. Implementation phases

### Phase A — Consolidate extension

1. Tách Wiki registration thành `wiki-commands.ts`.
2. Chuyển task prompt sang `wiki-prompt.ts`.
3. Register từ `harness/index.ts`.
4. Rename commands thành `/harness-wiki-*`.
5. Xóa `/wiki-*` registrations.
6. Guard UI và cleanup pending state.
7. Move README provenance.
8. Xóa extension `wiki/` cũ.

Gate:

```txt
Pi load thành công, command mới có mặt, command cũ không có mặt.
```

### Phase B — Introduce Markdown prompt-rule plane

1. Tạo root/section `_rules.md` reviewed scaffolds/content.
2. Update `AGENTS.md` bootstrap.
3. Update quickstart Rule loading section.
4. Implement path classification/discovery/lint helpers.
5. Implement deterministic section scaffolding.
6. Add tests.

Gate:

```txt
Model có đường dẫn rõ từ AGENTS → quickstart → root/section rules;
không có automatic full-rule injection.
```

### Phase C — Rewire improvements

1. Remove project detector JSON loader.
2. Giữ deterministic detectors/defaults trong runtime.
3. Update target proposal paths thành `_rules.md` hoặc runtime source.
4. Update reflection routing/importer normalization.
5. Lint Markdown rules after apply.
6. Update evals.

Gate:

```txt
Không còn runtime/proposal reference tới harness/rules/*.json hoặc _rules.json.
```

### Phase D — Integrate Wiki semantics

1. Protect `_rules.md` trong prompt và tool/apply gates.
2. Update docs snapshot/path classification.
3. Update no-op semantics.
4. Add prompt-rule file health vào status.
5. Ensure scaffold-only changes không update metadata.

Gate:

```txt
Rule-only changes trigger Wiki update consideration,
nhưng không làm metadata giả nếu normal docs không đổi.
```

### Phase E — Documentation and live verification

1. Update READMEs/spec/wiki pages.
2. Run runtime tests.
3. Run relevant evals.
4. `/reload` Pi cho extension source mới.
5. Manually test commands và lazy rule loading.
6. Inspect git diff, verify no private artifacts.

Gate:

```txt
Docs, source, tests và actual command/context behavior nhất quán.
```

---

## 32. Acceptance criteria

### Extension

- [ ] Chỉ có một Harness extension entrypoint.
- [ ] Wiki logic nằm trong Harness extension module.
- [ ] `/harness-wiki-init` chạy được.
- [ ] `/harness-wiki-update` chạy được.
- [ ] `/harness-wiki-ask` chạy được.
- [ ] `/harness-wiki-status` chạy được.
- [ ] Không còn `/wiki-*` command registrations.
- [ ] Không còn public `extensions/wiki/` entrypoint.

### Prompt rules

- [ ] `wiki/_rules.md` tồn tại.
- [ ] Mỗi final Wiki section có một `_rules.md`.
- [ ] Không có canonical `_rules.json` hoặc `harness/rules/*.json`.
- [ ] `_rules.md` chứa prompt guidance/checklists, không chứa detector config schema.
- [ ] Built-in detector implementation/defaults vẫn ở runtime.
- [ ] Rule proposals target section-level `_rules.md` hoặc runtime code đúng loại change.
- [ ] Prompt-rule path/content lint có error rõ ràng.

### Context loading

- [ ] `AGENTS.md` có bootstrap pointer.
- [ ] `wiki/quickstart.md` có Rule loading section.
- [ ] Root rules chỉ model tới applicable section rules.
- [ ] Rules được model đọc bằng tool, không auto-inject toàn bộ.
- [ ] Multi-domain task yêu cầu đọc mọi applicable rules.
- [ ] Không có watcher/cache/reload requirement cho Markdown content.
- [ ] Status không claim biết model đã load rule nào.

### Safety

- [ ] Normal Wiki/coding turn không được sửa `_rules.md`.
- [ ] Deterministic gate bảo vệ rule files trong Wiki mode.
- [ ] `.last-update.json` chỉ do extension ghi.
- [ ] Rule apply vẫn cần approval.
- [ ] Apply chỉ chạm target-listed files.
- [ ] Markdown rules được lint sau apply.
- [ ] Raw sessions/evidence/drafts không commit vào Wiki.
- [ ] Không auto-push.

### Wiki behavior

- [ ] Snapshot chỉ phản ánh normal documentation Markdown.
- [ ] Rule change không bị phân loại nhầm là docs-only.
- [ ] Rule-only change có thể làm `/harness-wiki-update` chạy.
- [ ] Nếu docs không đổi, metadata không update giả.
- [ ] Status hiển thị prompt-rule file/lint health.

### Verification

- [ ] `npm --prefix packages/harness-runtime test` pass.
- [ ] Relevant evals pass.
- [ ] Manual Pi `/reload` pass sau extension code changes.
- [ ] Lazy rule loading verified trong representative tasks.
- [ ] Git diff không chứa private Harness outputs.

---

## 33. Rủi ro và mitigation

| Rủi ro | Hậu quả | Mitigation |
|---|---|---|
| Model quên đọc rules | Guidance không áp dụng | `AGENTS.md` bootstrap + quickstart/root instructions + eval. |
| Model chọn thiếu section | Bỏ domain constraint | Explicit multi-domain rule-loading contract; root index; representative evals. |
| Prompt rule bị coi là security gate | Silent unsafe behavior | Enforce critical protections bằng `tool_call`/apply/runtime code. |
| Wiki model sửa `_rules.md` | Silent policy change | Prompt ownership + deterministic write protection + proposal-only apply. |
| Quickstart rule index stale | Model đọc sai/thiếu file | Status/link checks; update index khi section changes. |
| Rules mất sau compaction | Model dựa trên context cũ/thiếu | AGENTS bootstrap yêu cầu re-read trước edit và khi scope đổi. |
| Rules quá dài | Context/tool-result pollution | Một file/section, size lint, concise prompts, chỉ đọc matching sections. |
| Natural language conflict | Model hành xử không nhất quán | Stable IDs; conflict-report rule; human-reviewed proposal resolution. |
| Detector config bị viết thành prose | Runtime behavior không deterministic | Detector implementation/defaults chỉ ở runtime hoặc future config riêng. |
| `_rules.md` bị snapshot như docs | Metadata churn | Rule classification trước generic Markdown; snapshot exclude. |
| Rule change bị no-op skip | Docs/policy references stale | Rule path là meaningful change. |
| Evidence bị commit trong prompt rule | Privacy leak | Chỉ lưu origin proposal; lint/review; evidence private. |
| Command rename phá workflow cũ | User phải đổi command | Breaking change accepted; update docs/help; không alias. |

---

## 34. Non-goals của migration đầu tiên

Không làm:

- Auto-inject toàn bộ Wiki rules vào mọi Pi request.
- Track chính xác model đã load rule file nào.
- Watch `_rules.md` hoặc cache theo mtime/hash.
- Parse natural-language prompt rules thành detector params.
- Project-level detector tuning trong Wiki.
- Auto-approve/auto-apply rule improvements.
- Move raw/normalized session data vào repository.
- Move built-in detector source code vào Wiki.
- Tạo một rule file cho mỗi detector/rule.
- Giữ `/wiki-*` compatibility aliases.
- Dùng cả old JSON rules và Markdown rules lâu dài.
- Tự sửa auth/provider/settings nhạy cảm.

---

## 35. Final architecture summary

Command/documentation plane:

```txt
User inside Pi
  → /harness-wiki-*
  → packages/pi-learn-extensions/extensions/harness/index.ts
  → Harness Wiki module
  → concise command-specific user task prompt
  → current Pi model/tools
  → wiki normal documentation Markdown
```

Prompt-rule context plane:

```txt
Pi auto-loads AGENTS.md
  → bootstrap says read wiki/quickstart.md
  → quickstart says read wiki/_rules.md
  → model identifies task domains
  → model reads matching section _rules.md
  → rule content enters context as read tool results
  → model performs task
```

Improvement plane:

```txt
Harness runtime
  → normalized private evidence
  → detector/reflection
  → proposal
  → human approval
  → controlled Markdown patch
  → wiki/**/_rules.md
  → lint/eval
  → commit hoặc rollback
```

Repository knowledge/prompt plane:

```txt
wiki/
├── _rules.md                    # global reviewed prompt rules
├── quickstart.md                # docs + rule-loading index
├── architecture/
│   ├── _rules.md                # architecture/runtime prompt rules
│   └── *.md
├── extensions/
│   ├── _rules.md                # Pi extension prompt rules
│   └── *.md
└── operations/
    ├── _rules.md                # test/release/workflow prompt rules
    └── *.md
```

Private observability plane:

```txt
~/.pi/harness/projects/<project-key>/
├── sessions/
├── reports/
├── reflections/
├── proposals/
└── evals/
```

Core policy:

```txt
Wiki documents repository knowledge.
AGENTS and quickstart tell the model where prompt rules live.
The model lazily reads global and domain-local rules into context.
Prompt rules guide behavior but do not replace deterministic safety.
Runtime code implements detectors and enforcement.
Private evidence never becomes committed Wiki content by default.
Every prompt-rule improvement remains evidence-backed, reviewed,
testable and reversible.
```
