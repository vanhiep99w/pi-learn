# Testing and safety

Phạm vi: focused verification, failure/recovery checks và privacy cho Wiki/usage/Aurora/theme. Owners là component source và test suite dưới `packages/pi-learn-extensions/`; kiểm thử deterministic không thay semantic review tài liệu hoặc host integration.

## Automated tests

Root không có test script. Chạy từ root:

```bash
npm --prefix packages/pi-learn-extensions test
# Focused: run test:wiki, run test:aurora, run test:theme
node -e 'JSON.parse(require("node:fs").readFileSync("packages/pi-learn-extensions/themes/midnight-aurora.json", "utf8")); console.log("Theme JSON OK")'
```

Suite Wiki có 148 test pass trên Node v26.9.0 sau khi thêm read model và read tools; 39 tests baseline cũng pass trên phiên bản này. Đây không phải minimum supported Node; manifest không khai báo engines. File .mts import TypeScript source nên runner phải hỗ trợ strip types; command tests dùng `node:module.registerHooks` để ánh xạ riêng import `wiki-prompt.js` sang source `.ts`, tương tự loader jiti của Pi.

| Test source (trong `packages/pi-learn-extensions/tests/wiki/`) | Evidence được kiểm tra |
|---|---|
| `wiki-prompt.test.mts` | Init khảo sát có thứ tự, working model trong context, không tool/runtime manuals, optional plan/brief, bootstrap setup riêng và khớp AGENTS/CLAUDE; update giữ lookup/fallback, scope/intent/ownership; cả hai giữ safety, evidence/review/no-migration và không inject Git |
| `wiki-commands.test.mjs` | Guards/lifecycle hiện có; schema/graph trước no-op/finalization, clean-Git metadata-only status, invalid/no-change, warnings, interrupted repair, abort/error/retry/shutdown và giữ metadata khi không đổi |
| `wiki-rules.test.mjs` | Path classification, outside-root rejection, discovery/missing sections, IDs/origin lint, scaffold idempotency, symlink escape |
| `wiki-links.test.mjs` | Checked-in Wiki links, file/Unicode/duplicate anchors, punctuation, traversal/encoding, reserved sources, symlink target/root |
| `wiki-model.test.mts` | Wiki-only index, guides/specs, metadata lookup, filtered search/pagination, typed/reverse graph, schema diagnostics, duplicate IDs, external/same-size edits, root isolation, symlinks/escapes, UTF-8/size limits và provenance |
| `wiki-tools.test.mjs` | Sáu read tools/hai metadata tools/hai commands, active-run permits, cross-instance isolation, no legacy conversion, headless, scopes, safe rule lint, link targets không đọc protected text, JSON output budget/revision pagination, session/cwd replacement, sanitized YAML warnings và không mở quyền ghi; TypeBox host double |

`wiki-routing.test.mjs` kiểm section Unicode/BOM/CRLF/fences/duplicate anchors, bounded heading lists, exact/prefix source scopes, nhiều owners và invalid schema, source không bị mở, domain selectors/ancestor union, opt-in legacy compatibility, config lỗi/symlinks và không leak policy text. Tool fixtures kiểm pagination section lớn/stale output; command fixtures kiểm config-only snapshot và invalid-config no-op/finalization/repair. Config không được tạo trong repo thật; chỉ fixture tests.

`wiki-spec-writer.test.mts` kiểm source-paths create/add/remove qua YAML AST, comments/CRLF/body preservation và reject malformed scopes, ngoài exclusive create, strict authoring, duplicate/edge/cycle guards, revision conflicts, body/BOM/CRLF/comments/nested-field preservation, symlink/hardlink protection, cross-path create races, queued cancellation/run expiry và editor changes. Đây là filesystem fixtures, không chứng minh an toàn trước mọi external process race hoặc OS sandbox.

Tests core ThinkRail nguyên bản được giữ trong `extensions/wiki/vendor/thinkrail-spec-graph/core/core.test.ts`. Chạy riêng bằng `npm --prefix packages/pi-learn-extensions run test:wiki:upstream` (cần Bun); tại Bun v1.3.14 có 55 pass và 2 skips cho Windows/case-folding không có trên host này. Node suite không tự chạy Bun. `npm --prefix packages/pi-learn-extensions run test:wiki:host` là 1 smoke test riêng dùng Pi v1.5.0 loader + TypeBox thật trên fixture cwd/agentDir, kiểm discovery một entrypoint, schemas, headless tools, command handler/finalization (transport giả lập), create/update qua real Pi file queue và factory replacement. Dùng `PI_TEST_BIN` khi Pi không trên PATH; `PI_TEST_WIKI_EXTENSION` có thể trỏ tới entrypoint trong artifact cài tạm. Không tạo LLM/provider/session hoặc đọc user auth/settings. Chưa kiểm TUI `/reload` thật, model behavior, mọi host version hoặc migration. Graph/schema đã được nối vào no-op/finalization; full snapshot/Git failure/concurrency cases vẫn chưa được kiểm hết.

Ngoài Wiki, `tests/aurora/aurora-ui.test.mjs` kiểm banner/theme changes/width/cleanup, headless picker và editor tokens bằng host giả lập; `tests/theme/midnight-aurora.test.mjs` kiểm variable resolution, dark appearance, WCAG ≥4.5:1 cho các cặp chữ/nền khai báo và phân cấp dim/muted/text. Contrast audit chỉ áp dụng màu sRGB cụ thể, với `vars.bg` là nền terminal dự kiến; không bảo đảm nền terminal khác hoặc 256 màu.

Gaps: chưa kiểm hết Wiki snapshot/Git failure/concurrency và interrupted-recovery cases ngoài fixtures đã nêu, semantic classification bằng model thật, OAuth/account/network, Aurora trên host TUI thật hoặc theme schema. JSON parse chỉ kiểm syntax. Suite không chứng minh mọi rule được viết đúng nghĩa, mọi generated claim chính xác, hoặc mọi host Pi version tương thích. Không có test CI job trong workflow PR review đã inspect.

Muốn kiểm tra validators không ghi/scaffold files, từ root:

```bash
node --input-type=module -e '
import {validateWikiInternalLinks} from "./packages/pi-learn-extensions/extensions/wiki/wiki-links.js";
import {discoverWikiPromptRules} from "./packages/pi-learn-extensions/extensions/wiki/wiki-rules.js";
const projectRoot=process.cwd();
const links=validateWikiInternalLinks({projectRoot});
const rules=discoverWikiPromptRules({projectRoot});
console.log(JSON.stringify({links,rulesValid:rules.valid,errors:rules.errors,warnings:rules.warnings},null,2));
if(links.issues.length || !rules.valid) process.exitCode=1;
'
```

## Manual Pi verification

Sau source changes: automated checks → `/reload` hoặc restart đúng package đang test → affected commands/UI → status/diff. Runtime checklist dưới đây là **test cần thực hiện**, không phải khẳng định đã thực hiện trong run docs này. Chỉ dùng repository và tài khoản thử nghiệm được user cho phép.

### Wiki scenarios

| Scenario | Expected / recovery |
|---|---|
| `/wiki` trong disposable repo | Routed docs, bootstrap compact, extension scaffold thiếu; agent không sửa substantive rules |
| Agent busy | Notify warning, không bắt đầu run |
| `/wiki-update` không args, no meaningful changes | Skip nếu đủ [no-op conditions](../extensions/wiki-extension.md#no-op-behavior) |
| Update yêu cầu docs-only | Không skip; chỉ sửa affected docs, prompt yêu cầu giữ chính sách hiện tại |
| Update chính sách lâu dài không tên file/từ khóa | Agent tự chọn owning rule, preserve unrelated rules, final layout phải valid |
| Update chỉ thị một lần | Không lưu chỉ thị vào rule hoặc normal Wiki |
| Update có intent/thời hạn/owner mơ hồ | Hỏi về nội dung/scope, không bắt nêu tên file hay từ khóa |
| Rule lint invalid trước run | Init báo lỗi; update có thể bắt đầu để sửa |
| Invalid file/anchor link sau run | Issue source/line, interrupted metadata; sửa target/link rồi retry |
| Abort/shutdown sau đổi Wiki | Interrupted; retry có thể complete kể cả không thêm thay đổi nếu validation valid |
| Abort không đổi, valid links/rules | Metadata cũ giữ nguyên |
| Finalization exception | Notify error, kiểm tra docs và retry; không giả metadata đã được ghi |
| Ordinary project question | Quickstart một lần khi context chưa có, rules chỉ load khi chuẩn bị edit |

Chỉ hai command Wiki được register. Kiểm tra guards bằng fixtures trong repo tạm; không sửa metadata thật thủ công. Full contract ở [Wiki lifecycle](../extensions/wiki-extension.md#commands-and-run-lifecycle).

### ChatGPT usage and Aurora

- Chuyển supported/non-supported provider: usage refresh/clear đúng gate; không có OAuth phải hiện hướng dẫn login. Không dùng real token làm fixture.
- Ready cache <60 giây, force refresh và pending dedup; lỗi fetch sau ready hiển thị stale/cached, lỗi tiếp theo có thể mất snapshot theo [cache contract](../extensions/catalog.md#luồng-usage-và-cache).
- Test legacy authStorage và runtime APIs nếu host mục tiêu cung cấp, manual callback/device-code flow; thiếu API phải báo lỗi. Network failure không làm UI treo vô hạn là mục tiêu kiểm tra vì source chưa có fetch timeout.
- Login/list/switch/delete-one/delete-active/delete-all/cancel; kiểm tra fallback OpenCode có thể khiến usage xuất hiện lại sau delete. Không đọc credential thật trong Wiki run.
- Aurora: startup banner tự ẩn, ít nhất ba dòng editor, autocomplete còn nguyên, footer statuses không trùng usage; thử terminal hẹp/rộng và fullscreen/non-fullscreen.
- Git: repo sạch/modified/untracked/conflict và non-repo; Git lỗi phải mất badge thay vì crash.
- Theme picker/shortcut/cancel và theme đang active; JSON/schema/render. Banner phải phản ánh tên/màu mới ngay cả khi đổi theme trong 5 giây đầu. Thử `system` trên nền sáng/tối và `midnight-aurora` trên nền tối; extension không tự đổi lựa chọn.
- Shutdown/reload/session replacement: timers/subscriptions/status/widget cleanup; kiểm tra global/cache/pending và timeout details còn sống như [lifecycle gaps](../extensions/catalog.md#contract-dùng-chung-với-aurora).
- Print/JSON/headless không crash vì UI thiếu. Theme command/shortcut có hasUI guard và regression tests với host giả lập; vẫn cần kiểm tra các mode trên host thật.

## Security and privacy

Không đọc/quote/commit live `.env`, auth/account stores, keys, tokens, payload logs hoặc raw session logs. Chỉ sample placeholder không secret mới dùng làm fixture. Các tên path trong [catalog persistence](../extensions/catalog.md#account-state-và-persistence) là hợp đồng source, không cho phép đọc live stores.

Extension chạy với quyền OS user. Wiki `tool_call` guard chỉ kiểm named write/edit paths và bash regex cho mutation phổ biến; không cover mọi custom tool, codemode indirection, shell script hoặc write ngoài Wiki. Generated task prompt đặt write/read boundaries và selective-reading; đó không phải filesystem sandbox. Quyền sửa rule trong update không mở quyền truy cập secrets hoặc sửa metadata/brief.

Auth/account stores là JSON plaintext (mode 0600 best effort), không encrypted. OAuth refresh error hiện có thể kèm remote response text trong notification; redact trước chia sẻ diagnostic. JWT decode metadata không phải token validation. PR review có pull_request_target/secrets boundary cần audit riêng: [workflow](development.md#pr-review-workflow).

## Wiki path safety

- Metadata luôn extension-owned; brief được tool guard bảo vệ trong active run; rules bị bảo vệ trừ active `/wiki-update` cùng cwd (và extension scaffold thiếu).
- Rule discovery yêu cầu real Wiki root, bỏ directory symlink; rule file symlink chỉ cho resolve trong project. Link validator từ chối symlink Wiki root/target và realpath ngoài Wiki.
- Link traversal/file/anchor validation không thay kiểm tra Markdown đầy đủ hoặc claim evidence. Reserved rule/brief/temp pages không là source docs scan; rules lint là bước độc lập.
- Không coi scaffold, path checks hay regex guard là transaction/rollback. Failure có thể để docs partial; sửa topic/link/lint rồi retry, không xóa evidence để giả hoàn tất.

Chi tiết chính thức trong [validation contract](../extensions/wiki-extension.md#link-and-rule-validation).

## Git hygiene

```bash
git status --short --untracked-files=all
git diff --check
git diff -- wiki/ AGENTS.md CLAUDE.md
```

Chọn diff paths đúng scope khi sửa source. `.gitignore` không blanket-ignore toàn bộ private state; kiểm tra filename trước mở content. Không commit auth/.env/key/payload/session logs, temporary `_plan.md` hoặc unrelated local changes; không auto-push. Trong Wiki run, không edit `.last-update.json` (extension finalize sau settled), không sửa brief hoặc rules ngoài scope của active update.
