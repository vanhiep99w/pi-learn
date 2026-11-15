# Pi Learn Extensions Package

Package extension/theme mà root repository expose cho Pi Coding Agent.

## Cài và reload

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
# hoặc test tạm
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau khi cài/update, restart Pi hoặc chạy `/reload`.

## Nội dung package

```txt
extensions/
├── wiki/                    # /wiki và /wiki-update
├── chatgpt-usage-status/    # ChatGPT Plus/Pro usage
├── aurora-ui.ts             # custom TUI/editor/footer/status + navigation
└── aurora/                  # helpers sidebar/tree, không entrypoint riêng

themes/
└── midnight-aurora.json
```

## Wiki

```txt
/wiki [ghi chú]
/wiki-update [ghi chú]
```

- `/wiki` tạo Wiki ban đầu dưới `wiki/`. Sau init hợp lệ và không bị hủy/lỗi, hook `agent_settled` ghi section `Project Wiki` cố định vào top-level `AGENTS.md`/`CLAUDE.md` bằng code, giữ nội dung khác; nếu cả hai vắng thì tạo `AGENTS.md`. Không gửi mẫu này cho model chép lại; update không tự chạy bootstrap.
- `/wiki-update` dùng source hiện tại để cập nhật có chọn lọc. Cả hai command không đưa Git status, commit hoặc diff vào prompt; Git chỉ dùng nội bộ cho no-op detection và metadata.
- Trong `/wiki-update`, agent tự phân loại yêu cầu và chọn `wiki/**/_rules.md` thuộc domain phù hợp cho chính sách lâu dài; không cần tên file hay từ khóa đặc biệt. Khi không config, durable rule cho service `order/` thật thuộc `wiki/modules/order/_rules.md`, không phải `order/AGENTS.md`. Facts thuộc normal Wiki, chỉ thị một lần không được lưu; khi mơ hồ thì hỏi lại. Rule vẫn được bảo vệ ngoài lượt update.
- Không có command hỏi Wiki riêng. Agent dùng block `Project Wiki` trong `AGENTS.md`/`CLAUDE.md`: chỉ đọc `wiki/quickstart.md` cho câu hỏi về project khi context chưa có, và chỉ đọc rule áp dụng ngay trước khi sửa component liên quan.
- `wiki/INSTRUCTIONS.md` là brief do người dùng quản lý. `wiki/.last-update.json` do extension quản lý.
- Trước no-op và sau run, extension kiểm tra link nội bộ, rule layout và schema/graph. Graph/schema lỗi không được skip hay đánh dấu complete; warnings không chặn hoàn tất và không tự promote draft. Legacy guides vẫn hợp lệ khi không có graph nodes.
- Có sáu tools đọc: `wiki_search`, `wiki_get`, `wiki_locate`, `wiki_rules`, `wiki_graph`, `wiki_validate`, trên read model tái sử dụng core ThinkRail ở commit cố định. Graph/schema validation đã có trong no-op/finalization. Có hai tools metadata `wiki_spec_create`/`wiki_spec_update` chỉ trong active Wiki run cùng cwd; không migration hoặc tool xóa. Xem [provenance, license Apache-2.0 và patches](extensions/wiki/vendor/thinkrail-spec-graph/README.md).
- Prompt init tập trung research/write/safety/validation, không manuals tools; bootstrap do extension ghi sau validation, plan file chỉ khi cần và chưa có, brief vắng được bỏ qua. Update vẫn có lookup guidance. Specs theo module thực, IDs/relations có evidence và status draft; giữ trang/canonical owners hiện có, không chuyển đổi/split/move/duplicate tài liệu. Update giữ tri thức lâu dài của task, không chép checklist/history hoặc tự xóa user plans.
- `wiki_spec_create` không overwrite và luôn draft; `wiki_spec_update` dùng `wiki_get` → `data.revision` (không phải output revision), giữ nguyên prose bytes/comments/nested fields. Hết run/shutdown/replacement thì mất quyền ghi. Built-in write/edit với normal Wiki pages vẫn giữ quyền cũ; tools này không sửa rules/brief/metadata hoặc tự approve active/done.
- Search mặc định `scope: "all"` để tìm cả specs và guides cũ; get nhận đúng một `id` hoặc Wiki-relative `path`, mặc định metadata + headings, chỉ trả verbatim section khi có `heading` (exact title/`#anchor`, title trùng dùng `occurrence`). Graph chỉ có nodes cho tài liệu có metadata spec; không tự chuyển guides thành specs.
- `wiki_locate({sourcePath})` tìm tất cả spec owners có `source-paths` khớp literal file hoặc directory có `/` cuối; không mở source, không chọn winner hoặc theo rename. Create nhận `sourcePaths`; update dùng `addList`/`removeList` key `source-paths`. Không tự thêm metadata cho guides cũ.
- `wiki_rules({paths, task})` trả rule paths rồi dùng `read`, không dùng `wiki_get` cho reserved rules. Config `wiki/_domains.json` luôn authoritative. Khi vắng config, exact top-level service `order`, `order/` hoặc `order/src/Foo.java` chọn `wiki/modules/order/_rules.md` hiện có + root/ancestor rules, không cần config; không khớp giữ legacy known-minimum + consult quickstart. Resolver không đọc source/policy bodies, cấp quyền ghi hay tạo scaffold. Config chọn domains cho discovery/lint/scaffold; thiếu config vẫn giữ legacy final sections, config lỗi không fallback. Config được bảo vệ như rules ngoài active update. [Schema và convention](../../wiki/extensions/wiki-extension.md#source-scope-và-policy-domains).
- Validate mặc định `scope: "graph"`; `links`, `rules`, `all` là lựa chọn rõ ràng. Rule lint chỉ trả diagnostics, không trả nội dung policy và không tạo scaffold. Giới hạn tổng content + details 24 KiB/lượt; output lớn dùng JSON fragments có revision/continuation, không ghi bản đầy đủ ra file tạm.

Test:

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
# Optional: tests ThinkRail nguyên bản, cần Bun
npm --prefix packages/pi-learn-extensions run test:wiki:upstream
# Optional: Pi loader + TypeBox thật, cần Pi CLI đã cài
npm --prefix packages/pi-learn-extensions run test:wiki:host
```

## Herdsman profile setup

Subagents dùng external `pi-herdsman`; runtime ThinkRail, tests và `/subagents` cũ đã bị xóa. Wiki Spec Graph vẫn giữ vendored ThinkRail core riêng. Không tự cài Herdsman khi load Pi Learn.

Profile portable tại [`profiles/herdsman/`](profiles/herdsman/README.md) lưu `maxAgentDepth: 1`, Flexible Lead reference-first prompt, display/web extensions và web tools cho sáu bundled agents. Sau khi cài external packages và Herdr Pi integration, chạy `npm run setup:herdsman -- --dry-run`, rồi `npm run setup:herdsman` từ root hoặc subpackage. Script được đóng gói nhưng không auto-run/discover như Pi extension; không install, không đọc/sửa auth hoặc Pi settings. Paths được resolve theo máy; custom `--agent-dir`/`--packages-dir` được hỗ trợ. Giữ unrelated settings/model/prompts; schema/deny conflicts được báo lỗi. Chạy lại sau khi thay profile; reload parent và spawn child mới để áp dụng. Chi tiết safety/limitations và setup máy mới ở README profile.

## ChatGPT usage status

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete
/chatgpt-logout
```

Extension chỉ hiện status cho provider `openai-codex` hoặc `chatgpt`. Auth/account data được lưu local, không commit vào repository.

## Aurora UI

Aurora UI cung cấp startup banner, editor chỉ có viền ngang, footer tối giản, working message tiếng Việt, cwd/git status, theme picker và điều hướng phiên:

```txt
/aurora-themes
/sidebar
/tree-v2
```

Sidebar có nút **≡** trên editor, trái/phải, click chỉ cuộn tới câu hỏi, không thay nhánh. `/tree-v2` giữ cây thật, thu xử lý user cũ, mở câu hiện tại; assistant một dòng và tools chỉ tiêu đề, lùi 2 cột. **Enter chọn vị trí thật như `/tree`**, Space/click bung/thu. `/tree` gốc giữ nguyên; `/tree-v2 sample` không điều hướng phiên thật.

Hai phần được đăng ký bởi `aurora-ui.ts`, không cần `-e .pi/demos/sidebar-demo/index.ts`. Không load demo cũ cùng Aurora để tránh duplicate widget/command. Helpers chỉ nằm trong `extensions/aurora/`, không import `.pi/**`. [Phím, lifecycle, native navigation và giới hạn](extensions/aurora/README.md).

Aurora dùng semantic tokens của theme đang active, không tự bật theme đi kèm hoặc ghi settings. Banner/sidebar/tree đọc màu mỗi render, kể cả khi đổi sáng/tối: nền `customMessageBg`, chọn `selectedBg`, thinking `thinkingText`, tool `toolTitle`, lỗi `error`; không giữ palette cố định của demo. Picker, sidebar và tree có UI/mode guards.

- **`system`** (khuyến nghị): chọn trong `/settings → Theme` để theo bảng màu/nền sáng tối của terminal. Pi tự sinh màu; Pi Learn không triển khai bộ sinh màu riêng.
- **`midnight-aurora`**: palette Aurora cố định cho nền tối, chọn trong settings:

```json
{
  "theme": "midnight-aurora"
}
```

`midnight-aurora` không đổi màu nền terminal. Nền tối gần `#0b1020` là nền dự kiến; chọn `system` khi cần thích nghi với nền khác. Các cặp chữ/nền trong contrast tests phải đạt WCAG 4.5:1, bao gồm chữ phụ, trạng thái, panel, vùng chọn, Markdown/syntax và HTML export. Kiểm tra này không bảo đảm kết quả trên mọi terminal hoặc khi màu bị xấp xỉ sang 256 màu.

Kiểm thử:

```bash
npm --prefix packages/pi-learn-extensions test
npm --prefix packages/pi-learn-extensions run test:aurora
npm --prefix packages/pi-learn-extensions run test:theme
# Cần Pi đã cài; PTY thêm Python pexpect:
npm --prefix packages/pi-learn-extensions run test:navigation
npm --prefix packages/pi-learn-extensions run test:navigation:pty
```

Aurora tests dùng host giả lập, kiểm banner/theme change/width/cleanup, headless picker và editor tokens. Sau `/reload`, thử thêm `system` trên nền sáng/tối, `midnight-aurora`, terminal hẹp và fullscreen/regular.

## Package manifest

Root package expose resources này:

```json
{
  "pi": {
    "extensions": [
      "./packages/pi-learn-extensions/extensions/wiki/index.ts",
      "./packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts",
      "./packages/pi-learn-extensions/extensions/aurora-ui.ts"
    ],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

Manifest dùng file entrypoints tường minh thay vì scan cả thư mục; runtime subagents ThinkRail đã bị xóa, không còn entrypoint để bật lại. `wiki/index.ts` vẫn là entrypoint duy nhất cho Wiki. `aurora/` không có index/manifest, chỉ được `aurora-ui.ts` import để không đăng ký sidebar/tree hai lần.
