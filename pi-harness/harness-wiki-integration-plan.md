# Kế hoạch hợp nhất Harness Wiki và domain-local rules

> Trạng thái: thiết kế đã thống nhất ở mức định hướng, chưa triển khai code.
>
> Ngày ghi nhận: 2026-07-10.
>
> Phạm vi tài liệu: hợp nhất Wiki extension vào Harness extension, đổi command sang `/harness-wiki-*`, và chuyển project-level Harness rules sang mô hình một `_rules.json` cho mỗi section của `wiki/`.

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
    └── domain-local reviewed rules
```

Các mục tiêu cụ thể:

1. Chỉ còn một public Pi extension entrypoint cho Harness.
2. Toàn bộ command Wiki dùng namespace `/harness-wiki-*`.
3. Xóa hoàn toàn command `/wiki-*`; không giữ alias tương thích.
4. Không tạo đường dẫn trung gian `wiki/harness/`.
5. Mỗi section có ý nghĩa trong `wiki/` có đúng một file `_rules.json` tương ứng.
6. Harness rules nằm cạnh domain mà chúng điều khiển thay vì gom trong `harness/rules/`.
7. Wiki Markdown và rule JSON có ownership rõ ràng, không được model sửa lẫn nhau ngoài lifecycle cho phép.
8. Rule improvement vẫn đi qua evidence → proposal → approval → apply → validation.
9. Raw session, normalized cache, reports, reflection prompts và draft proposals vẫn là dữ liệu private ngoài repository.

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
| Rule layout | Root và mỗi wiki section có một `_rules.json`. |
| Không dùng | Không dùng `wiki/harness/rules/` và không dùng một JSON riêng cho mỗi rule. |
| Built-in detector code | Vẫn nằm trong `packages/harness-runtime/src/**`. Không chuyển source code runtime vào wiki. |
| Reviewed project rules | Chuyển sang `wiki/**/_rules.json`. |
| Draft/evidence | Vẫn nằm trong `~/.pi/harness/`, không commit vào wiki. |
| Apply safety | Human approval, target-file allowlist, git checks, test/eval và rollback vẫn được giữ. |

Đây là breaking change có chủ đích. Tài liệu, prompt và command help sau migration chỉ nói về `/harness-wiki-*`.

---

## 3. Hiện trạng trước migration

### 3.1 Extension hiện tại

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
/harness-reflect-pi
/harness-proposals
/harness-approve
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

### 3.2 Rule config hiện tại

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

Các path này phải được thay bằng section-level `_rules.json` sau migration.

### 3.3 Wiki no-op hiện tại

Wiki extension hiện coi mọi path dưới `wiki/` là Wiki content. Khi rule JSON được đặt trong `wiki/`, cách phân loại này không còn đủ chính xác vì:

- Markdown là documentation content.
- `_rules.json` là reviewed Harness configuration.
- `.last-update.json` là extension metadata.

Migration phải phân biệt ba nhóm path này.

---

## 4. Kiến trúc extension sau migration

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
| `wiki-commands.ts` | Orchestration cho init/update/ask/status, git context, no-op, snapshot và metadata. |
| `wiki-prompt.ts` | Prompt discipline cho Harness Wiki bằng current Pi model/tools. |
| `README.md` | Command reference, OpenWiki provenance, intentional differences và upgrade notes. |

Có thể tách thêm helper sau này nếu file lớn, nhưng không được tạo một nested extension entrypoint thứ hai. Chỉ `harness/index.ts` export default extension factory.

### 4.1 Registration pattern

Kiến trúc code khuyến nghị:

```ts
export default function harnessExtension(pi: ExtensionAPI) {
  registerHarnessTooling(pi);
  registerHarnessCommands(pi);
  registerHarnessWikiCommands(pi);
  registerHarnessEvents(pi);
}
```

Wiki module chỉ export hàm register/helper; không export một default Pi extension khác.

### 4.2 Xóa source cũ

Sau khi code đã được chuyển và test:

```txt
packages/pi-learn-extensions/extensions/wiki/index.ts
packages/pi-learn-extensions/extensions/wiki/prompt.ts
packages/pi-learn-extensions/extensions/wiki/README.md
```

sẽ được xóa. Nội dung provenance/upgrade có giá trị trong README cũ phải được chuyển sang Harness README hoặc tài liệu thiết kế liên quan trước khi xóa.

---

## 5. Command surface cuối cùng

### 5.1 Command được giữ

Các Harness command hiện hữu tiếp tục dùng namespace Harness:

```txt
/harness-status [last]
/harness-report [last]
/harness-reflect-pi [last]
/harness-proposals
/harness-approve P-0001
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note [text]
```

### 5.2 Harness Wiki command

Chỉ đăng ký:

```txt
/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
/harness-wiki-status
```

### 5.3 Không có compatibility alias

Không đăng ký:

```txt
/wiki-init
/wiki-update
/wiki-ask
/wiki-status
```

Không dùng duplicate command, hidden alias hoặc deprecation notification. Sau migration, gọi `/wiki-*` phải được xem là command không tồn tại.

### 5.4 Command reference trong prompt

Mọi nội dung hard-code hiện nói:

```txt
/wiki-init
/wiki-update
/wiki-ask
/wiki-status
```

phải đổi sang:

```txt
/harness-wiki-init
/harness-wiki-update
/harness-wiki-ask
/harness-wiki-status
```

Các nơi cần rà soát gồm:

- Harness Wiki prompt.
- Extension README.
- Root README.
- Package README.
- `wiki/quickstart.md` và wiki extension docs.
- Startup notification/status text.
- Test fixtures/snapshots nếu có.

---

## 6. Cấu trúc Wiki và domain-local rules

Cấu trúc mục tiêu cho repository hiện tại:

```txt
wiki/
├── _rules.json
├── .last-update.json
├── quickstart.md
├── architecture/
│   ├── _rules.json
│   ├── overview.md
│   └── harness-runtime.md
├── extensions/
│   ├── _rules.json
│   ├── catalog.md
│   └── wiki-extension.md
└── operations/
    ├── _rules.json
    ├── development.md
    └── testing-and-safety.md
```

Không dùng:

```txt
wiki/harness/rules/edit-tool-failure.json
wiki/rules/edit-tool-failure.json
harness/rules/edit-tool-failure.json
```

Một section-level file chứa toàn bộ rules của section đó:

```txt
wiki/_rules.json
wiki/architecture/_rules.json
wiki/extensions/_rules.json
wiki/operations/_rules.json
```

### 6.1 Định nghĩa Wiki section

Một directory được coi là Wiki section nếu:

1. Nằm dưới `wiki/`.
2. Không phải hidden/system directory.
3. Chứa ít nhất một Markdown page cuối cùng của một domain.
4. Không chỉ tồn tại để chứa asset hoặc temporary file.

Root `wiki/` luôn là global section.

Ví dụ được coi là section:

```txt
wiki/
wiki/architecture/
wiki/extensions/
wiki/operations/
```

Ví dụ không bắt buộc có `_rules.json`:

```txt
wiki/.cache/
wiki/assets/
wiki/_tmp/
```

### 6.2 Một file cho mỗi section

Mỗi section có tối đa và theo contract là đúng một file:

```txt
_rules.json
```

Không tạo một file JSON cho từng rule. Các rule được lưu trong array `rules` của section file.

Lợi ích:

- Rule nằm cạnh domain documentation tương ứng.
- Dễ review toàn bộ policy của một domain.
- Tránh hàng chục JSON file nhỏ.
- Dễ load theo section/path.
- Dễ validate duplicate/conflict.
- Proposal target luôn có path ổn định.

---

## 7. `_rules.json` schema đề xuất

### 7.1 File tối thiểu

```json
{
  "schemaVersion": 1,
  "section": "extensions",
  "description": "Rules for Pi extensions and package behavior.",
  "sourceGlobs": [
    "packages/pi-learn-extensions/extensions/**",
    "packages/pi-learn-extensions/themes/**"
  ],
  "rules": []
}
```

File có `rules: []` vẫn có giá trị vì nó khai báo section và mapping từ source paths sang Wiki domain.

### 7.2 File có detector và guidance rules

```json
{
  "schemaVersion": 1,
  "section": "extensions",
  "description": "Rules for Pi extensions and package behavior.",
  "sourceGlobs": [
    "packages/pi-learn-extensions/extensions/**",
    "packages/pi-learn-extensions/themes/**"
  ],
  "rules": [
    {
      "id": "EXT-UI-001",
      "kind": "guidance",
      "name": "Guard interactive Pi UI operations",
      "enabled": true,
      "instruction": "Guard interactive UI operations with ctx.hasUI and use optional UI access where contexts may become stale.",
      "checks": [
        "Use ctx.hasUI before dialogs or large TUI changes.",
        "Use ctx.ui?. for best-effort notifications and cleanup.",
        "Dispose timers, listeners and compositor state on shutdown."
      ],
      "originProposal": "P-0012"
    },
    {
      "id": "R-0002",
      "kind": "detector",
      "name": "Repeated tool error",
      "enabled": true,
      "params": {
        "minOccurrences": 3
      },
      "originProposal": "P-0013"
    }
  ]
}
```

### 7.3 Top-level fields

| Field | Type | Bắt buộc | Ý nghĩa |
|---|---|---:|---|
| `schemaVersion` | number | yes | Version schema; bắt đầu bằng `1`. |
| `section` | string | yes | Stable section id, thường tương ứng relative Wiki directory. |
| `description` | string | yes | Mô tả ngắn domain của file. |
| `sourceGlobs` | string[] | yes | Repository-relative source patterns thuộc domain. Root rules có thể dùng global scope. |
| `rules` | object[] | yes | Danh sách detector/guidance rules của section. |

### 7.4 Common rule fields

| Field | Type | Bắt buộc | Ý nghĩa |
|---|---|---:|---|
| `id` | string | yes | Stable rule id. |
| `kind` | `detector` hoặc `guidance` | yes | Cách runtime sử dụng rule. |
| `name` | string | yes | Tên ngắn, dễ đọc. |
| `enabled` | boolean | yes | Bật/tắt rule mà không cần xóa lịch sử. |
| `originProposal` | string | recommended | Proposal đã được approve dẫn tới rule. Không chứa evidence excerpt. |

### 7.5 `kind: "detector"`

Detector rule điều chỉnh deterministic Harness rule engine.

Ví dụ:

```json
{
  "id": "R-0001",
  "kind": "detector",
  "name": "Repeated bash failure",
  "enabled": true,
  "params": {
    "minOccurrences": 3
  },
  "originProposal": "P-0020"
}
```

Ý nghĩa:

- `id` có thể trùng ID của built-in detector để override/tune detector đó theo scope.
- `params` là JSON object được detector tương ứng validate.
- File config không chứa detector implementation code.

### 7.6 `kind: "guidance"`

Guidance rule là reviewed instruction/checklist cho Harness reflection và Harness Wiki workflows.

Ví dụ:

```json
{
  "id": "OPS-EDIT-001",
  "kind": "guidance",
  "name": "Use exact edit blocks",
  "enabled": true,
  "instruction": "Re-read the target block before retrying an exact-text edit.",
  "checks": [
    "Confirm oldText is exact.",
    "Confirm oldText is unique.",
    "Combine adjacent changes into one edit block."
  ],
  "originProposal": "P-0021"
}
```

Guidance rules không mặc định được coi là global Pi system prompt. Trong phase migration này chúng được dùng bởi:

- Harness reflection target routing.
- Harness proposal generation.
- `/harness-wiki-init` và `/harness-wiki-update` khi làm việc với section tương ứng.
- `/harness-wiki-ask` khi trả lời về section tương ứng.

Nếu sau này muốn inject guidance vào mọi coding turn, đó phải là một feature riêng, có scope matching, prompt-size limit và opt-in policy. Không tự động đưa toàn bộ Wiki rules vào mọi LLM request trong migration đầu tiên.

---

## 8. Validation contract

Harness phải validate `_rules.json` trước khi dùng.

### 8.1 Path validation

- Rule file phải nằm trong project root.
- Rule file phải có basename chính xác `_rules.json`.
- Không chấp nhận absolute path trong `sourceGlobs`.
- Không chấp nhận path traversal `..`.
- Normalize separator sang repository-relative POSIX form.
- Không đọc rule files từ symlink trỏ ra ngoài project root.

### 8.2 Schema validation

- `schemaVersion` phải được hỗ trợ.
- `section` không rỗng và stable.
- `sourceGlobs` chỉ chứa string hợp lệ.
- `rules` phải là array.
- `id`, `kind`, `name`, `enabled` phải đúng type.
- `detector.params` phải là object.
- `guidance.instruction` phải là string không rỗng.
- `guidance.checks` nếu có phải là string array.

### 8.3 ID validation

ID nên dùng pattern:

```txt
[A-Z][A-Z0-9-]{2,63}
```

Ví dụ:

```txt
R-0001
EXT-UI-001
OPS-EDIT-001
ARCH-PARSER-001
```

### 8.4 Size limits

Để tránh rule bloat và prompt pollution, nên có giới hạn:

```txt
max file size: 64 KiB
max rules per section: 100
max instruction length: 2,000 chars
max checks per guidance rule: 20
```

Các con số có thể config sau, nhưng MVP cần hard limit an toàn.

### 8.5 Invalid rules policy

- `/harness-wiki-status` luôn chạy được và hiển thị validation errors.
- Rule-dependent proposal/improvement commands fail closed nếu rule registry invalid.
- `/harness-wiki-init` và `/harness-wiki-update` không được chạy với invalid active rule files, trừ bootstrap khi chưa có file.
- Report/scan read-only không cần rules vẫn có thể chạy, nhưng phải báo warning nếu sau đó proposal generation sẽ bị block.
- Không silently bỏ qua malformed JSON rồi tiếp tục apply proposal.

---

## 9. Rule discovery

Runtime tìm rule files bằng pattern:

```txt
wiki/**/_rules.json
```

Discovery phải:

1. Resolve project root.
2. Resolve `wiki/` dưới project root.
3. Luôn kiểm tra `wiki/_rules.json` trước.
4. Traverse section directories deterministically.
5. Sort path theo POSIX lexical order.
6. Parse và validate từng file.
7. Build registry theo section, source globs và rule id.

Pseudo flow:

```txt
project root
  → wiki/_rules.json
  → wiki/architecture/_rules.json
  → wiki/extensions/_rules.json
  → wiki/operations/_rules.json
  → validate
  → build effective rule registry
```

Không scan:

```txt
node_modules/**
.git/**
wiki/.*/**
wiki/_tmp/**
```

---

## 10. Rule scope và inheritance

### 10.1 Root rules

`wiki/_rules.json` là global Wiki/Harness project rule layer.

Ví dụ phù hợp với root:

- Secret/path safety chung.
- Exact edit workflow chung.
- Git hygiene chung cho mọi domain.
- Rule áp dụng cho nhiều section và không có một domain rõ ràng.

### 10.2 Section rules

Section rules áp dụng khi:

- Đang đọc/sửa Markdown trong section đó; hoặc
- Source/target file match `sourceGlobs` của section.

Ví dụ:

```txt
packages/harness-runtime/src/session/parse-session.js
  → wiki/_rules.json
  → wiki/architecture/_rules.json

packages/pi-learn-extensions/extensions/aurora-ui.ts
  → wiki/_rules.json
  → wiki/extensions/_rules.json

package.json hoặc release docs
  → wiki/_rules.json
  → wiki/operations/_rules.json
```

### 10.3 Effective rule order

Precedence đề xuất:

```txt
built-in runtime defaults
  < wiki/_rules.json
  < matching section _rules.json
  < explicit command/runtime option override
```

### 10.4 Multiple matching sections

Nếu một source file match nhiều section globs:

- Tất cả rule có ID khác nhau được hợp nhất.
- Cùng ID ở root và một matching child section: child override root.
- Cùng ID ở hai sibling sections cùng match: validation/conflict error.
- Không chọn ngẫu nhiên theo filesystem order.

### 10.5 Disabled rule

Rule section có thể tắt built-in/root rule bằng cùng ID:

```json
{
  "id": "R-0002",
  "kind": "detector",
  "name": "Repeated tool error",
  "enabled": false,
  "params": {},
  "originProposal": "P-0030"
}
```

Disable vẫn cần approved proposal và audit trail.

---

## 11. Mapping đề xuất cho Wiki hiện tại

### 11.1 Root

```txt
wiki/_rules.json
```

Phạm vi:

```txt
global project safety
global edit workflow
global source-of-truth guidance
global Wiki maintenance constraints
```

### 11.2 Architecture

```txt
wiki/architecture/_rules.json
```

Source globs gợi ý:

```json
[
  "packages/harness-runtime/src/**",
  "packages/harness-runtime/tests/**",
  "packages/harness-runtime/package.json",
  "pi-harness/**"
]
```

Rule phù hợp:

- Parser/normalizer warnings.
- Cache/storage invariants.
- Redaction boundary.
- Proposal lifecycle architecture.
- Runtime test requirements.

### 11.3 Extensions

```txt
wiki/extensions/_rules.json
```

Source globs gợi ý:

```json
[
  "packages/pi-learn-extensions/extensions/**",
  "packages/pi-learn-extensions/themes/**",
  "packages/pi-learn-extensions/package.json"
]
```

Rule phù hợp:

- `ctx.hasUI` and optional UI access.
- Cleanup timers/listeners/compositor.
- Pi command naming.
- TypeBox schema/tool descriptions.
- Package extension loading boundaries.

### 11.4 Operations

```txt
wiki/operations/_rules.json
```

Source globs gợi ý:

```json
[
  "package.json",
  "package-lock.json",
  "README.md",
  "docs/**",
  ".github/**"
]
```

Rule phù hợp:

- Test/reload workflow.
- Git status/diff hygiene.
- Release/version synchronization.
- Documentation indexing.
- Repeated bash failure checks.

---

## 12. Rule ownership

Ownership phải được encode cả trong prompt và runtime behavior.

```txt
wiki/**/*.md
  owner: Harness Wiki documentation workflow

wiki/**/_rules.json
  owner: Harness proposal + approval + controlled apply lifecycle

wiki/.last-update.json
  owner: Harness Wiki extension metadata finalizer
```

### 12.1 Wiki agent được phép

Trong `/harness-wiki-init`, `/harness-wiki-update`, `/harness-wiki-ask`:

- Đọc effective `_rules.json`.
- Dùng guidance rules làm constraint.
- Dùng detector metadata để hiểu Harness behavior khi viết docs.
- Cập nhật Markdown trong wiki theo command mode.
- Đề xuất rule improvement qua Harness proposal nếu evidence đủ mạnh.

### 12.2 Wiki agent không được phép

- Tự thêm rule vào `_rules.json` trong một documentation turn.
- Tự tune threshold.
- Tự disable rule.
- Tự ghi `originProposal` giả.
- Tự sửa `.last-update.json`.
- Đưa normalized evidence excerpt vào committed rule file.

### 12.3 Ai được sửa rule file

Actual rule changes chỉ đi qua:

```txt
normalized evidence
  → deterministic/LLM proposal
  → user review
  → /harness-approve P-xxxx
  → /harness-apply P-xxxx
  → rule validation
  → tests/eval
  → commit hoặc rollback
```

---

## 13. Bootstrap `_rules.json`

Có một ngoại lệ cần thiết: tạo metadata-only scaffold cho Wiki section mới.

### 13.1 Root scaffold

`/harness-wiki-init` phải bảo đảm tồn tại:

```txt
wiki/_rules.json
```

Nếu chưa có, extension có thể tạo deterministic scaffold:

```json
{
  "schemaVersion": 1,
  "section": "root",
  "description": "Global Harness Wiki rules for this repository.",
  "sourceGlobs": [],
  "rules": []
}
```

### 13.2 Section scaffold

Sau documentation turn, extension scan các final Wiki section directories. Với section thiếu `_rules.json`, extension có thể tạo metadata-only scaffold:

```json
{
  "schemaVersion": 1,
  "section": "extensions",
  "description": "Harness Wiki rules for wiki/extensions.",
  "sourceGlobs": [],
  "rules": []
}
```

Đây không phải rule improvement vì chưa có active rule. Nó chỉ tạo schema container và section identity.

### 13.3 Source mapping sau bootstrap

`sourceGlobs` không nên được model tự invent rồi silently activate. Có hai cách an toàn:

1. Repository migration ban đầu thêm reviewed source globs cùng code change này.
2. Project mới dùng proposal để populate/tune `sourceGlobs` sau khi Wiki đã được tạo.

`/harness-wiki-status` phải cảnh báo section có `sourceGlobs: []`, vì section đó mới chỉ có path-local scope cho Wiki docs và chưa match source code.

---

## 14. Rule improvement lifecycle theo section

### 14.1 Proposal target selection

Khi target là `rules`, Harness không tạo file mới theo tên detector. Nó chọn một existing section file:

```txt
wiki/_rules.json
wiki/architecture/_rules.json
wiki/extensions/_rules.json
wiki/operations/_rules.json
```

Thuật toán đề xuất:

1. Lấy proposal `targetFiles` hoặc evidence source paths.
2. Match với `sourceGlobs` của các section.
3. Nếu một section là common/best match rõ ràng, target section `_rules.json` đó.
4. Nếu không có section hoặc nhiều section ngang nhau, target `wiki/_rules.json` và ghi rõ cần human review về scope.
5. Không tự tạo arbitrary nested section chỉ để chứa rule.

### 14.2 Ví dụ routing

Repeated edit oldText mismatch dùng chung toàn repo:

```txt
target: wiki/_rules.json
```

Repeated parser warning:

```txt
target: wiki/architecture/_rules.json
```

Repeated unsafe Pi extension UI operation:

```txt
target: wiki/extensions/_rules.json
```

Repeated release/test bash failure:

```txt
target: wiki/operations/_rules.json
```

### 14.3 Proposal fields

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
rule id
rule kind
detector params hoặc guidance instruction/checks
false-positive risk
expected matching scope
origin proposal id
```

### 14.4 Apply validation

Sau apply nhưng trước commit:

1. Parse changed `_rules.json`.
2. Validate schema.
3. Validate duplicate IDs/conflicts.
4. Rebuild effective registry.
5. Run rule tests.
6. Run relevant eval.
7. Nếu fail, không commit và cung cấp rollback.

---

## 15. Built-in rules và project rules

Không chuyển toàn bộ rule engine vào Wiki.

### 15.1 Giữ trong runtime

```txt
packages/harness-runtime/src/analysis/rules.js
packages/harness-runtime/src/improve/target-proposals.js
packages/harness-runtime/src/reflection/reflection.js
packages/harness-runtime/src/eval/eval-harness.js
packages/harness-runtime/tests/**
```

Các file trên chứa:

- Detector implementation.
- Dataset loading.
- Grouping/fingerprinting.
- Proposal generation.
- Reflection routing.
- Eval implementation.

### 15.2 Chuyển sang Wiki

Chỉ reviewed project-level artifacts:

- Detector enable/disable/tuning config.
- Domain-local reviewed guidance.
- Section/source mapping.
- Proposal origin metadata không nhạy cảm.

### 15.3 Không chuyển

- Raw session logs.
- Normalized events/warnings.
- Private evidence excerpts.
- Draft proposals.
- Proposal history private.
- Eval reports có session evidence.
- Runtime implementation code.
- Auth/settings/secrets.

---

## 16. Private storage không thay đổi

Mọi dữ liệu quan sát và draft tiếp tục ở:

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

Rule file trong `wiki/` chỉ là reviewed result đã được phép commit. Không copy full evidence vào rule file.

Một rule đã commit nên dùng:

```json
"originProposal": "P-0012"
```

thay vì:

```json
"evidence": [
  {
    "sessionFile": "/home/.../.pi/agent/sessions/...",
    "excerpt": "..."
  }
]
```

---

## 17. Harness Wiki prompt changes

Prompt mới phải tự nhận diện là Harness Wiki, không tiếp tục tự xưng là một extension độc lập.

Wording mục tiêu:

```txt
You are Harness Wiki, the repository-knowledge capability of Pi Harness.
```

Không dùng command reference `/wiki-*`.

### 17.1 Prompt rules mới

Prompt phải nói rõ:

- Dùng current Pi provider/model/tools.
- Ground claims in inspected source/docs/git evidence.
- Markdown documentation nằm trong `wiki/`.
- Đọc `wiki/_rules.json` trước.
- Trước khi sửa một section, đọc section `_rules.json` nếu tồn tại.
- Không sửa `_rules.json` trong Wiki documentation turn.
- Không sửa `.last-update.json`.
- Nếu thấy cần cải thiện rule, chỉ mô tả nhu cầu hoặc tạo proposal qua Harness workflow được yêu cầu; không silent edit.
- Không đọc secrets/raw sessions/payload logs.

### 17.2 Root instruction section

Wiki reference trong `AGENTS.md`/`CLAUDE.md` phải đổi command examples sang `/harness-wiki-*` nếu command được nhắc đến.

Critical bootstrap/safety instructions vẫn có thể nằm trong `AGENTS.md`. Không chuyển mọi instruction khỏi `AGENTS.md` chỉ vì có Wiki rules.

Lý do:

- Pi tự động nạp `AGENTS.md`.
- Pi không tự động nạp tất cả `_rules.json` vào mọi coding turn.
- Rule chi tiết có thể nằm trong Wiki, nhưng critical bootstrap pointer vẫn cần ở top-level agent instruction.

---

## 18. Snapshot và metadata semantics

### 18.1 Path classes

Phải có helper rõ ràng:

```txt
isWikiDocumentationPath(path)
isWikiRulePath(path)
isWikiMetadataPath(path)
```

Phân loại:

```txt
wiki/**/*.md             → documentation
wiki/**/_rules.json      → Harness rules
wiki/.last-update.json   → metadata
```

### 18.2 Documentation snapshot

Snapshot dùng để quyết định documentation changed chỉ nên hash final Wiki documentation content.

Bao gồm:

```txt
wiki/**/*.md
```

Loại trừ:

```txt
wiki/.last-update.json
wiki/**/_rules.json
wiki/_plan.md
hidden/temp files
```

Lý do loại `_rules.json`:

- Rule apply không phải documentation generation.
- Không ghi `.last-update.json` chỉ vì một proposal vừa chỉnh rule.
- Metadata Wiki phải phản ánh docs update, không phản ánh mọi Harness config update.

### 18.3 Metadata writer

Sau `/harness-wiki-init` hoặc `/harness-wiki-update`:

- Nếu Markdown snapshot thay đổi, ghi `wiki/.last-update.json`.
- Nếu chỉ deterministic scaffold `_rules.json` được tạo mà Markdown không đổi, không coi đó là documentation update.
- Agent/model không được tự ghi metadata.

---

## 19. No-op update semantics

Current behavior có thể skip khi Git HEAD chỉ thay đổi các path dưới `wiki/`. Sau migration không thể coi mọi `wiki/**` là docs-only.

### 19.1 Docs-only changes

Nếu HEAD chỉ thay đổi:

```txt
wiki/**/*.md
wiki/.last-update.json
```

thì `/harness-wiki-update` có thể skip nếu docs đã chính là thay đổi vừa được commit và không có source impact khác.

### 19.2 Rule changes

Nếu HEAD hoặc working tree thay đổi:

```txt
wiki/**/_rules.json
```

thì update không được skip chỉ vì path bắt đầu bằng `wiki/`.

Rule change phải được xem là meaningful Harness configuration change vì:

- Documentation có thể cần phản ánh policy mới.
- Status/index có thể cần cập nhật.
- Rule mapping có thể thay đổi domain behavior.

### 19.3 Source changes

Bất kỳ non-documentation source/config change nào vẫn làm update chạy như hiện tại.

### 19.4 Suggested no-op predicate

Pseudo logic:

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

---

## 20. `/harness-wiki-status` output

Status mới nên hợp nhất Wiki và rule registry health.

Ví dụ:

```txt
Harness Wiki status
- cwd: /repo
- docs: wiki/ exists
- git head: <sha>
- docs snapshot: <sha256>
- last update: {...}
- update no-op: no (rule config changed)
- rule files: 4
- active rules: 7
- disabled rules: 1
- unmapped sections: 0
- rule validation: valid

Sections
- root: wiki/_rules.json (2 rules)
- architecture: wiki/architecture/_rules.json (2 rules)
- extensions: wiki/extensions/_rules.json (2 rules)
- operations: wiki/operations/_rules.json (1 rule)
```

Nếu invalid:

```txt
- rule validation: invalid
- wiki/extensions/_rules.json: duplicate rule id EXT-UI-001
```

Status không được in private evidence hoặc raw session paths.

---

## 21. Runtime implementation changes

### 21.1 Rule registry module

Nên thêm module chuyên trách, ví dụ:

```txt
packages/harness-runtime/src/analysis/wiki-rule-registry.js
```

Trách nhiệm:

```txt
discoverWikiRuleFiles(project)
parseWikiRuleFile(path)
validateWikiRuleFile(value)
resolveEffectiveRules({ project, targetFiles, wikiSection })
findRuleTargetFile({ project, targetFiles })
```

Tên module có thể thay đổi, nhưng không nên tiếp tục nhét toàn bộ discovery/schema logic vào `analysis/rules.js`.

### 21.2 `analysis/rules.js`

Cần đổi:

- Không đọc `<project>/harness/rules/*.json`.
- Load effective detector rules từ Wiki rule registry.
- Merge built-in defaults với root/section overrides.
- Giữ detector algorithms trong runtime.
- Surface validation errors có path rõ ràng.

### 21.3 `improve/target-proposals.js`

Cần đổi proposal targets:

```txt
harness/rules/edit-tool-failure.json
  → selected wiki section/_rules.json

harness/rules/bash-failure-repeat.json
  → selected wiki section/_rules.json
```

Test plan text cũng không được nhắc `/harness-propose` nếu extension không đăng ký command đó. Command canonical cho improvement phải được quyết định và dùng nhất quán khi implement, ví dụ:

```txt
/harness-improve rules
```

hoặc expose runtime propose bằng một command Harness thực sự. Không để test plan tham chiếu command không tồn tại.

### 21.4 `reflection/reflection.js`

Target routing guide phải đổi từ:

```txt
rules → harness/rules/** or src/analysis/rules/**
```

sang:

```txt
rules → wiki/**/_rules.json for reviewed project config/guidance,
        or packages/harness-runtime/src/analysis/** for detector implementation changes
```

Importer target normalization cũng phải nhận diện `_rules.json` là valid `target=rules`.

### 21.5 Proposal lifecycle

Controlled apply phải:

- Cho phép target `wiki/**/_rules.json` nếu nằm trong proposal allowlist.
- Không cho proposal target một `_rules.json` nhưng patch sang file section khác.
- Validate full registry sau apply.
- Không commit nếu registry invalid.
- Giữ clean-worktree/branch/history/rollback guarantees hiện tại.

---

## 22. Extension UI safety trong lúc merge

Wiki extension hiện có nhiều direct `ctx.ui` calls. Khi nhập vào Harness extension cần chuẩn hóa theo Pi safety rules:

- Dùng `ctx.hasUI` trước dialog/editor/select.
- Dùng `ctx.ui?.notify`, `ctx.ui?.setStatus` cho best-effort UI.
- Có console/text fallback ở print/JSON modes khi phù hợp.
- Không để metadata finalizer crash nếu session UI đã thay đổi.
- Clear `harness-wiki` status trong `finally`.
- Reset pending Wiki run trong `session_shutdown` hoặc session replacement nếu cần.

Status key đề xuất:

```txt
harness-wiki
```

Không dùng generic `wiki` key sau khi extension đã được hợp nhất.

---

## 23. Migration policy

### 23.1 Command migration

Không có command compatibility period.

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

### 23.2 Source migration

```txt
extensions/wiki/index.ts
  → extensions/harness/wiki-commands.ts

extensions/wiki/prompt.ts
  → extensions/harness/wiki-prompt.ts

extensions/wiki/README.md
  → merge relevant content into extensions/harness/README.md
```

### 23.3 Rule data migration

Old project files nếu có:

```txt
harness/rules/*.json
```

không thể luôn tự động map chính xác sang domain, vì vậy không nên silently move theo filename.

Migration an toàn:

1. Discover old rule files.
2. Parse và validate.
3. Classify theo target/source domain.
4. Merge từng rule vào section `_rules.json` phù hợp.
5. Preserve stable rule ID và params.
6. Ghi `originProposal`/migration note không chứa evidence.
7. Run tests/eval.
8. Xóa old files trong cùng reviewed migration patch.

Repo hiện tại không có committed `harness/rules/`, nên migration ban đầu chủ yếu là đổi runtime loader và future proposal targets.

### 23.4 Không legacy fallback lâu dài

Target architecture không tiếp tục đọc đồng thời cả:

```txt
harness/rules/*.json
wiki/**/_rules.json
```

Dual source of truth sẽ gây ambiguity. Nếu cần migration helper, helper chỉ dùng một lần và phải báo rõ; runtime steady state chỉ dùng Wiki rule registry.

---

## 24. Documentation changes khi triển khai

Các tài liệu đang mô tả path/command cũ phải được cập nhật cùng implementation.

Ít nhất gồm:

```txt
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
AGENTS.md command references nếu có
```

Không cập nhật docs hàng loạt chỉ để đổi wording; nhưng mọi contract về command, path, ownership và rule target phải nhất quán.

Tên `wiki/extensions/wiki-extension.md` có thể giữ nếu trang mô tả capability, hoặc đổi thành một trang Harness Wiki phù hợp trong một docs migration có link update đầy đủ.

---

## 25. Test plan

### 25.1 Rule registry unit tests

Thêm test cho:

- Discover root và nested `_rules.json`.
- Stable path ordering.
- Valid empty section file.
- Detector rule parse.
- Guidance rule parse.
- Invalid schema version.
- Malformed JSON.
- Invalid ID.
- Absolute/traversal source glob.
- Duplicate ID trong một file.
- Root → section override.
- Sibling conflict.
- Disabled rule.
- Multiple source globs match.
- Section without source globs warning.
- File-size/rule-count limits.

### 25.2 Rule engine tests

Update:

```txt
packages/harness-runtime/tests/rules.test.js
```

Cases:

- Built-ins work without Wiki overrides.
- `wiki/_rules.json` tunes built-in detector.
- Section rule overrides root rule.
- Source target selects correct section.
- Invalid registry blocks proposal generation.

### 25.3 Target proposal tests

Update:

```txt
packages/harness-runtime/tests/target-proposals.test.js
```

Verify:

- Edit workflow routes to root or selected section `_rules.json`.
- Parser improvement routes to architecture rules/code as appropriate.
- Extension guidance routes to extensions `_rules.json`.
- No proposal targets `harness/rules/*.json`.

### 25.4 Reflection tests

Update:

```txt
packages/harness-runtime/tests/reflection.test.js
```

Verify:

- Routing guide uses `wiki/**/_rules.json`.
- `_rules.json` target is recognized as `rules`.
- AGENTS-only changes still normalize to `agents`.
- Rule proposal keeps evidence private in proposal, not committed rule patch.

### 25.5 Proposal lifecycle tests

Update:

```txt
packages/harness-runtime/tests/proposal-lifecycle.test.js
```

Verify:

- Approved patch can update listed `_rules.json`.
- Patch cannot update a different section file.
- Invalid post-apply registry prevents commit.
- Rollback restores previous valid registry.

### 25.6 Harness Wiki tests

Nên extract pure helpers và test:

- Documentation path classification.
- Rule path classification.
- Metadata path classification.
- Snapshot includes Markdown only.
- Snapshot excludes `_rules.json` and metadata.
- Rule-only Git change prevents no-op skip.
- Docs-only Git change may skip.
- Metadata-only change does not trigger update.
- Section scaffolding creates one `_rules.json` per Wiki section.
- Scaffolding does not create rules for assets/temp directories.

### 25.7 Command registration test/manual check

After load:

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

### 25.8 Runtime test command

```bash
npm --prefix packages/harness-runtime test
```

### 25.9 Manual Pi verification

```txt
/reload
/harness-status
/harness-wiki-status
/harness-wiki-ask Wiki rules được tổ chức thế nào?
/harness-wiki-update
/harness-wiki-update kiểm tra rule mapping và chỉ cập nhật docs liên quan
```

Kiểm tra thêm:

- `/wiki-status` không còn trong autocomplete.
- No-op update hoạt động khi repo không đổi.
- Thay `_rules.json` làm no-op status chuyển sang cần update.
- Wiki update không sửa `_rules.json`.
- Metadata chỉ cập nhật khi Markdown thay đổi.

---

## 26. Eval scenarios cần giữ/thêm

Các eval hiện tại vẫn cần chạy:

```txt
redaction-fixture
parser-unknown-entry
edit-oldText-workflow
file-protection
smart-commit-basic
ts-extension-safety
```

Nên thêm:

```txt
wiki-rule-file-protection
wiki-rule-section-routing
wiki-rule-invalid-registry
harness-wiki-command-surface
```

### 26.1 `wiki-rule-file-protection`

Expected:

- Harness Wiki documentation prompt không sửa `_rules.json`.
- Proposal apply có thể sửa khi approved và target-listed.

### 26.2 `wiki-rule-section-routing`

Expected:

- Extension evidence → `wiki/extensions/_rules.json`.
- Parser evidence → `wiki/architecture/_rules.json`.
- Cross-cutting evidence → `wiki/_rules.json`.

### 26.3 `wiki-rule-invalid-registry`

Expected:

- Duplicate/conflicting ID được phát hiện.
- Apply không commit invalid registry.

### 26.4 `harness-wiki-command-surface`

Expected:

- Chỉ `/harness-wiki-*` được đăng ký.
- Không có `/wiki-*` alias.

---

## 27. Implementation phases

### Phase A — Consolidate extension

1. Tách Wiki registration thành `wiki-commands.ts`.
2. Chuyển prompt sang `wiki-prompt.ts`.
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

### Phase B — Add Wiki rule registry

1. Định nghĩa schema.
2. Implement discovery/validation.
3. Implement scope/source matching.
4. Implement precedence/conflict handling.
5. Add root/section scaffolds.
6. Add unit tests.

Gate:

```txt
Runtime load được root + section rules deterministic và fail rõ khi invalid.
```

### Phase C — Rewire improvements

1. Update rule engine loader.
2. Update target proposal paths.
3. Update reflection routing.
4. Update importer normalization.
5. Validate registry after apply.
6. Update evals.

Gate:

```txt
Không còn runtime/proposal reference tới harness/rules/*.json.
```

### Phase D — Integrate Wiki semantics

1. Protect `_rules.json` in prompt.
2. Update documentation snapshots.
3. Update no-op classification.
4. Add rule health to status.
5. Load effective guidance for Wiki workflows.

Gate:

```txt
Rule-only changes trigger Wiki update consideration, nhưng không làm metadata giả nếu docs không đổi.
```

### Phase E — Documentation and live verification

1. Update READMEs/spec/wiki pages.
2. Run runtime tests.
3. Run relevant evals.
4. `/reload` Pi.
5. Manually test all Harness Wiki commands.
6. Inspect git diff and verify no private artifacts.

Gate:

```txt
Docs, source, tests và actual command surface nhất quán.
```

---

## 28. Acceptance criteria

Migration hoàn thành khi tất cả điều kiện sau đúng:

### Extension

- [ ] Chỉ có một Harness extension entrypoint.
- [ ] Wiki logic nằm trong Harness extension module.
- [ ] `/harness-wiki-init` chạy được.
- [ ] `/harness-wiki-update` chạy được.
- [ ] `/harness-wiki-ask` chạy được.
- [ ] `/harness-wiki-status` chạy được.
- [ ] Không còn `/wiki-*` command registrations.
- [ ] Không còn public `extensions/wiki/` entrypoint.

### Rules

- [ ] `wiki/_rules.json` tồn tại.
- [ ] Mỗi final Wiki section có một `_rules.json`.
- [ ] Runtime discover/validate rules recursively.
- [ ] Built-in detector implementation vẫn ở runtime.
- [ ] Project rule config không còn dùng `harness/rules/*.json`.
- [ ] Rule proposal target section-level `_rules.json`.
- [ ] Duplicate/conflicting rules fail rõ ràng.
- [ ] Guidance/detector rules được phân biệt.

### Safety

- [ ] Wiki documentation turn không sửa `_rules.json`.
- [ ] `.last-update.json` chỉ do extension ghi.
- [ ] Rule apply vẫn cần approval.
- [ ] Apply chỉ chạm target-listed files.
- [ ] Registry được validate sau apply.
- [ ] Raw sessions/evidence/drafts không được commit vào Wiki.
- [ ] Không auto-push.

### Wiki behavior

- [ ] Snapshot chỉ phản ánh documentation Markdown.
- [ ] Rule change không bị phân loại nhầm là docs-only.
- [ ] Rule-only change có thể làm `/harness-wiki-update` chạy.
- [ ] Nếu docs không đổi, metadata không bị cập nhật giả.
- [ ] Status hiển thị rule registry health.

### Verification

- [ ] `npm --prefix packages/harness-runtime test` pass.
- [ ] Relevant evals pass.
- [ ] Manual Pi `/reload` pass.
- [ ] Git diff không chứa private Harness outputs.

---

## 29. Rủi ro và cách giảm thiểu

| Rủi ro | Hậu quả | Mitigation |
|---|---|---|
| Wiki model sửa rule JSON | Silent policy change | Prompt protection + proposal-only ownership + eval. |
| Mọi Wiki folder bị tạo file rỗng vô nghĩa | Repository noise | Chỉ section directory có final Markdown page; scaffold vẫn chứa section mapping metadata. |
| Source globs overlap | Conflicting effective rules | Deterministic merge; same-ID sibling conflict là validation error. |
| Rules làm prompt quá dài | Context pollution | Size/count limits; load only root + matching sections. |
| Dual old/new rule paths | Hai source of truth | One-time migration; steady state chỉ dùng `wiki/**/_rules.json`. |
| Rule file commit evidence nhạy cảm | Privacy leak | Chỉ lưu `originProposal`; evidence private trong harness home. |
| Command rename phá workflow cũ | User phải đổi command | Breaking change đã được chấp nhận; update toàn bộ docs/help, không alias. |
| Rule change bị no-op skip | Docs trở nên stale | Phân biệt rule path khỏi docs path. |
| Snapshot tính cả rule | Metadata churn | Snapshot chỉ hash Markdown documentation. |
| Guidance rules không được Pi đọc tự động | Rule trở thành thụ động ngoài Harness | Dùng trong Harness Wiki/reflection trước; giữ critical AGENTS bootstrap; global injection là feature riêng. |
| Invalid rule apply làm hỏng runtime | Proposal generation fail | Post-apply validation + tests/eval + rollback. |

---

## 30. Non-goals của migration đầu tiên

Không làm trong phase này:

- Auto-inject toàn bộ Wiki guidance vào mọi Pi turn.
- Auto-approve hoặc auto-apply rule improvements.
- Move raw/normalized session data vào repository.
- Move built-in detector source code vào Wiki.
- Tạo dashboard/vector DB/background daemon.
- Tạo một rule file cho mỗi detector.
- Giữ `/wiki-*` compatibility aliases.
- Dùng cả `harness/rules/` và `wiki/**/_rules.json` lâu dài.
- Tự sửa auth/provider/settings nhạy cảm.

---

## 31. Final architecture summary

```txt
User inside Pi
  → /harness-wiki-*
  → packages/pi-learn-extensions/extensions/harness/index.ts
  → Harness Wiki module
  → current Pi model/tools
  → wiki/**/*.md

Harness runtime
  → normalized private evidence
  → detector/reflection
  → proposal
  → human approval
  → controlled apply
  → wiki/**/_rules.json
  → validation/eval
  → commit hoặc rollback
```

Repository knowledge plane:

```txt
wiki/
├── _rules.json                 # global reviewed rules
├── quickstart.md               # human/agent entrypoint
├── architecture/
│   ├── _rules.json             # architecture/runtime rules
│   └── *.md
├── extensions/
│   ├── _rules.json             # Pi extension rules
│   └── *.md
└── operations/
    ├── _rules.json             # test/release/workflow rules
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
Wiki documents knowledge.
Section rule files hold reviewed domain-local Harness policy.
Runtime code implements deterministic detectors.
Private evidence never becomes committed Wiki content by default.
Every rule improvement remains evidence-backed, reviewed, testable and reversible.
```
