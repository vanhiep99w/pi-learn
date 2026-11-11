# Subagents

Subagents cho phép parent giao một task tự chứa cho child có conversation context riêng, chạy foreground hoặc background. Runtime reuse ThinkRail `pi-subagents` + `pi-delegation`, pin commit `883affb98416fddd2d8c4f7f18fba92cc435cb4b`. Child mặc định **dùng chung cwd/worktree/branch**, không phải filesystem sandbox hoặc worktree riêng. Không có workflow router được bật kèm.

## Dùng và theo dõi

Sau reload đúng source/package, agent có hai tools:

```ts
Agent({ subagent_type: "scout", task: "Tìm caller của hàm X và báo paths/lines" })
Agent({ subagent_type: "worker", task: "Sửa module A; không chạm module B", run_in_background: true })
get_subagent_result({ session_id: "id do Agent trả về" })
```

- Foreground chờ final report; nhiều Agent calls trong cùng assistant message có thể chạy song song, tối đa 4 running children/parent, phần còn lại queued.
- Background trả child ID ngay. Report tự được append/deliver đúng thời điểm hoặc đánh thức parent đang idle; không cần polling/sleep. Pull result trước lúc report được deliver sẽ đánh dấu collected để tránh gửi lặp.
- `get_subagent_result` chỉ đọc registry của parent hiện tại, không replay raw transcripts. Sau restart registry mất; lỗi có thể chỉ đường dẫn transcript còn trên disk, không tự đọc nó.
- `/subagents` liệt kê ID/role/status của các child thuộc session này. `/subagents stop <id>` hoặc `/subagents stop all` yêu cầu hủy, không sửa source/history. Headless dùng console thay UI.
- Foreground theo tool abort signal. Khi parent bị abort, host yêu cầu dừng mọi owned children, kể cả background. Reload/shutdown dispose cả queued/running/finished children, clear completion timer/cache và làm old tool closures mất hiệu lực. Có thể gọi lại tools trong extension instance mới, không khôi phục workers tự động.

Tool `Agent` và `get_subagent_result` có exposure `model-only`, không mở đường recursion qua codemode/nested-tool calls. Tasks tối đa 32.000 characters. Report model-facing tối đa 32 KiB; details chỉ có bounded task + usage/status, không chứa full report/transcript ẩn. Có tối đa 32 retained children/parent, gồm finished reports; khi đạt cap cần session mới để tạo thêm. Turn limit mặc định 24, definition có thể chọn tới 64; đây là wrap-up rồi abort theo driver upstream, không phải hard token/dollar budget.

## Agent definitions

Builtins gồm `scout`, `planner`, `worker`, `reviewer`. Host map `spec_*` references của builtins sang Wiki tools và cho builtins đọc project context theo trust của parent.

Precedence giữ nguyên upstream: **builtin → personal → project `.pi/agents` → project `.agents/agents`**, first name wins. Project definitions chỉ được xét khi `ctx.isProjectTrusted()` true; trust bị revoke sau discovery cũng không được dispatch project agent. Personal definitions ở `getAgentDir()/agents/`; không tự cài file vào user config.

Ví dụ file `.pi/agents/triage.md` trong repo tin cậy:

```markdown
---
name: triage
description: Tìm nguyên nhân lỗi, chỉ báo evidence và đề xuất sửa
tools: read, grep, find, ls
max_turns: 8
inherit_project_context: true
---
Đọc các phần liên quan và trả về paths/lines, failure scenario và hướng sửa tối thiểu.
```

Parser upstream là flat frontmatter, không phải full YAML: fields `name`, `description`, `tools`, `model`, `thinking`, `max_turns`, `inherit_project_context`, `skills`, `extensions`; lists dùng comma-separated hoặc inline brackets. Body là role prompt, không phải history của parent. Reader chỉ mở regular UTF-8 definition files, không symlinks/hardlink aliases/NUL và tối đa 64 KiB/file, 64 file reads/discovery. Names hợp lệ tối đa 64 ký tự chữ/số/underscore/hyphen; description tối đa 1024 ký tự. Files lỗi bị bỏ qua, không echo source contents vào error.

## Model và quyền của child

Model và thinking mặc định kế thừa parent. `Agent.model` có thể chọn physical model nằm trong available/scoped models của parent; `provider/id`, exact ID, unique prefix và thinking suffix theo upstream. Definition pin thắng invocation model; explicit definition thinking thắng suffix. Reference mơ hồ/unavailable phải fail, không tự chọn model khác. Virtual-model routing chưa hỗ trợ: chọn physical model khi dispatch.

Auth vẫn thuộc parent registry: child in-memory runtime chuyển streaming request qua public registry API, không copy API keys/OAuth tokens, không load auth/models stores riêng hoặc đọc private runtime field. Provider/auth refresh hiện có của parent tiếp tục xử lý request; child report không chứa credential data. Test chỉ dùng runtime-only synthetic key và Faux provider, chưa kiểm network OAuth providers thật.

Child tools là giao của requested role tools, active parent tools tại birth và curated tools host hỗ trợ: SDK `read/bash/edit/write/grep/find/ls`, cộng sáu Wiki read tools khi definition bật `extensions`. Builtins đã bật; custom definitions dùng `extensions: true` khi muốn Wiki tools. Không tự load arbitrary user/project extensions hoặc packages trong child; settings in-memory. MCP, tool-discovery bridges và nested Agent/result tools bị loại/chặn. Các extension/approval hooks khác của parent **không tự được clone**; tool-name ceiling không có nghĩa đã kế thừa toàn bộ permission system.

Shared Wiki guard luôn bật, dù definition tắt extensions: child không được đổi `_rules.md`, `_domains.json`, `INSTRUCTIONS.md` hoặc `.last-update.json` của Wiki, kể cả parent đang có active `/wiki-update`. Không truyền mutation permit cho child. Builtins/custom prompts yêu cầu không đọc secrets/raw logs, đọc applicable rules trước edits và để changes uncommitted. Shell checks chỉ là best-effort common-mutation detection, không bảo đảm chặn mọi script. Scout/reviewer có bash theo upstream: read-only là mục đích làm việc, không là OS-enforced read-only environment; planner không có write/edit/bash tools. Parent cần chia task tránh ghi cùng file và review diff trước commit.

## Ownership và lưu trữ

Các paths tương đối với `packages/pi-learn-extensions/extensions/`:

| Source | Trách nhiệm |
|---|---|
| `subagents/index.ts` | Public entrypoint duy nhất |
| `subagents/adapter.ts` | Parent/cwd lifecycle, limits, tool ceiling, report/control adapter |
| `subagents/model-bridge.ts` | In-memory native-provider proxy qua parent registry |
| `subagents/definitions.ts` | Reuse discovery + bounded reader, Wiki naming/safety additions |
| `subagents/vendor/thinkrail/` | Hai packages, tests gốc, license/provenance/patch |
| `wiki/wiki-protection.ts` | Shared Wiki mutation checks, dùng chung với Wiki owner |

Child transcripts do SDK ghi dưới `getAgentDir()/delegation/pi-learn-subagents/<parentSessionId>/`, ngoài repository; không tự xóa dữ liệu sau shutdown. Scope/lineage riêng, không ảnh hưởng parent transcript. Parent chỉ nhận task report/metadata, không tự inject transcript. Chưa có UI quản lý retention, worktree isolation, interactive child sessions hoặc arbitrary extension/MCP forwarding.

## Kiểm chứng

```bash
npm --prefix packages/pi-learn-extensions run test:subagents
npm --prefix packages/pi-learn-extensions run test:subagents:upstream
npm --prefix packages/pi-learn-extensions run test:subagents:host
```

Node tests dùng mocks và synthetic files; upstream suite giữ 186 tests byte-identical, chạy bằng Bun trên temp copies/host peers. Host smoke dùng Pi v1.5.2 + TypeBox thật, Faux provider và isolated/in-memory stores, kiểm foreground/context/tool/auth bridge, protected Wiki write và background delivery/collection. Không đọc user auth/session logs, không gọi model/network thật. Chưa kiểm `/reload` và stop trên TUI thật, platform khác Linux hoặc mọi provider/host version. [Testing and safety](../operations/testing-and-safety.md#automated-tests) ghi phạm vi chung.
