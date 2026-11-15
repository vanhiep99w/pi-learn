# Pi Learn

Pi Learn là package cho Pi Coding Agent, gồm Wiki repository, giao diện Aurora và tài liệu học Pi bằng tiếng Việt. Subagents dùng Pi Herdsman cài riêng, với profile setup portable đi kèm; không còn runtime subagents ThinkRail trong repo.

## Thành phần

```txt
packages/pi-learn-extensions/
├── extensions/
│   ├── wiki/                    # /wiki và /wiki-update
│   ├── chatgpt-usage-status/    # trạng thái usage ChatGPT
│   ├── aurora-ui.ts             # editor/footer/status + sidebar + /tree-v2
│   └── aurora/                  # helper nội bộ, không auto-load riêng
└── themes/
    └── midnight-aurora.json

docs/                            # tài liệu Pi tiếng Việt
wiki/                            # Wiki của chính repository này
```

Package không còn runtime quan sát session, proposal/eval/apply, công cụ tạo ảnh hoặc công cụ prompt theo model.

## Cài đặt

Cài toàn cục từ GitHub:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Cài riêng cho project hiện tại:

```bash
pi install -l git:github.com/vanhiep99w/pi-learn@main
```

Chạy thử mà không ghi settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau khi cài hoặc cập nhật extension/theme, restart Pi hoặc chạy:

```txt
/reload
```

## Wiki repository

Wiki dùng model/provider hiện tại của Pi, bổ sung tools tra cứu và metadata spec có kiểm soát; prose vẫn được sửa bằng filesystem tools hiện tại:

```txt
/wiki [ghi chú thêm]
/wiki-update [ghi chú thêm]
```

- `/wiki` khởi tạo tài liệu dưới `wiki/`. Sau init hợp lệ, không hủy/lỗi, extension tự ghi section `Project Wiki` cố định vào top-level `AGENTS.md`/`CLAUDE.md` (cả hai vắng thì tạo `AGENTS.md`), giữ nội dung khác; mẫu không nằm trong prompt gen Wiki.
- `/wiki-update` cập nhật tài liệu theo source hiện tại và yêu cầu cụ thể; prompt không chứa Git status, lịch sử commit hoặc diff.
- Trong chat thường hoặc `/wiki-update`, agent tự phân biệt facts, user-requested lasting policy và chỉ thị một lần, rồi chọn trang Wiki hoặc `_rules.md` phù hợp. Không cần nêu tên file hay từ khóa đặc biệt, ví dụ:

  ```txt
  /wiki-update Khi viết code tôi không muốn tự thêm unit test nữa
  ```

  Chỉ thị một lần không được lưu; yêu cầu mơ hồ thì hỏi lại. Ví dụ nhắn thường “thêm rule cho order: không viết unit test mới” sẽ dùng `wiki/modules/order/_rules.md`, không tạo `order/AGENTS.md` thay Wiki policy. Init vẫn chặn rule edits; metadata/active brief giữ bảo vệ. Intent do model phân loại, không phải semantic enforcement.

- Không có command hỏi Wiki riêng. Với câu hỏi về project, agent đọc `wiki/quickstart.md` một lần khi context hiện tại chưa có; câu hỏi không liên quan project thì không cần đọc.
- Rule chỉ được load ngay trước khi agent cần sửa component/domain mà rule đó quản lý. Read-only question không bắt buộc load rule.
- `wiki/INSTRUCTIONS.md` là brief tùy chọn để định hướng scope, ưu tiên và ngôn ngữ.
- Extension kiểm tra internal links, rule layout và schema/graph trước khi cập nhật `wiki/.last-update.json`. Graph lỗi chặn no-op và đánh dấu run `interrupted`, kể cả khi Wiki không đổi; hoàn tất không đồng nghĩa specs đã được review.

Agent có sáu tools đọc: `wiki_search` (specs + guides), `wiki_get` (metadata mặc định, section khi chọn heading), `wiki_locate` (source path → declared spec owners), `wiki_rules` (existing rule paths và missing creation targets theo tên service), `wiki_graph` (quan hệ có giới hạn) và `wiki_validate` (graph mặc định; links/rules/all khi chọn rõ). Không cần config: `order/` → `wiki/modules/order/_rules.md` kể cả chưa có. Agent `read` existing `rulePaths`, chỉ tạo missing `suggestedRulePaths` khi user yêu cầu rule. Không tự chuyển đổi Wiki hoặc policy files. Hai tools `wiki_spec_create`/`wiki_spec_update` chỉ hoạt động trong active Wiki run cùng cwd: tạo draft mới hoặc sửa metadata với document revision, không sửa prose/ID và không ghi protected files. Wiki cũ giữ nguyên, không migration; vẫn search/get theo path được nhưng chưa có graph nodes. Sau update cần `/reload` đúng package đang dùng.

Chi tiết và pagination: [`Wiki read tools`](wiki/extensions/wiki-extension.md#read-only-wiki-tools).

## Subagents với Pi Herdsman

Pi Learn không còn runtime, tools `Agent`/`get_subagent_result` hoặc command `/subagents` của ThinkRail. Dùng external `pi-herdsman` trong Herdr TUI; `/herdsman` quản lý agents. Hai manifests Pi Learn vẫn chỉ auto-load Wiki, ChatGPT usage và Aurora. Nếu settings/CLI cũ có entry trỏ trực tiếp vào runtime đã xóa, bỏ entry đó; không sửa cấu hình cá nhân tự động.

**Portable Herdsman setup:** configs đã chọn được lưu ở [`profiles/herdsman/`](packages/pi-learn-extensions/profiles/herdsman/README.md): depth 1, Flexible Lead reference-first prompt và display/web cho sáu agents. Sau khi cài Herdsman, tool-display, web-access và Herdr integration, chạy từ checkout Pi Learn:

```bash
npm run setup:herdsman -- --dry-run
npm run setup:herdsman
```

Script opt-in, không chạy khi load extension; resolve paths trên từng máy, giữ unrelated config/prompts. Cấu hình tiếp theo của profile này nên sửa trong repo trước rồi setup lại, không copy generated config/credentials giữa các máy.

Herdsman có lifecycle, definitions, model/auth và tools riêng; không tự kế thừa guard/tool ceiling của runtime ThinkRail đã bỏ. Wiki Spec Graph vẫn reuse ThinkRail core độc lập, không bị ảnh hưởng.

## ChatGPT usage status

Extension hiển thị usage khi provider hiện tại là `openai-codex` hoặc `chatgpt`.

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete
/chatgpt-logout
```

Credential được lưu local bởi Pi/extension, không nằm trong repository.

## Aurora UI và theme

Aurora UI cung cấp startup banner, editor/footer/status tùy biến, thông tin cwd/git, sidebar danh sách câu hỏi và cây phiên gọn:

```txt
/aurora-themes
/sidebar
/tree-v2
```

- Nút **≡** trên ô nhập bật/tắt sidebar; click câu hỏi chỉ cuộn transcript, không đổi nhánh.
- `/tree-v2`: câu cũ chỉ hiện nội dung user, câu hiện tại mở xử lý lùi 2 cột; assistant chỉ một dòng `assistant: đoạn trích…`, tools chỉ tiêu đề.
- **Enter chuyển vị trí thật như `/tree`**, Space/click mới bung/thu chi tiết. `/tree` gốc giữ nguyên. Có lựa chọn tóm tắt nhánh trước khi chuyển.
- Hai tính năng đã nằm trong Aurora, **không cần nạp `.pi/demos/sidebar-demo` bằng `-e`**. Không nạp đồng thời demo cũ để tránh trùng sidebar. Chi tiết/phím/giới hạn: [Aurora navigation](packages/pi-learn-extensions/extensions/aurora/README.md).

Aurora dùng màu của theme đang active, không tự đổi lựa chọn của bạn. Để hòa hợp với bảng màu terminal và tự thích nghi sáng/tối, chọn **`system`** trong `/settings → Theme`. Đây là theme mặc định của Pi khi chưa cấu hình theme.

Nếu thích phong cách Aurora cố định trên nền tối, chọn **`midnight-aurora`**:

```json
{
  "theme": "midnight-aurora"
}
```

Banner hiển thị tên theme đang active. Theme `midnight-aurora` có contrast tests cho chữ trên panel/vùng chọn; nền terminal nên tối, gần `#0b1020`. Theme này không tự đổi nền terminal; dùng `system` nếu muốn theo nền terminal bất kỳ.

## Web search

Pi Learn không đóng gói web tools. Nếu cần `web_search`, cài riêng:

```bash
pi install git:github.com/nicobailon/pi-web-access
```

## Tài liệu

- [`docs/README.md`](docs/README.md) — mục lục tài liệu Pi tiếng Việt.
- [`PI_DOCUMENTATION.md`](PI_DOCUMENTATION.md) — tài liệu tổng hợp ở root.
- [`wiki/quickstart.md`](wiki/quickstart.md) — bản đồ thay đổi cho repository này.
- [`packages/pi-learn-extensions/README.md`](packages/pi-learn-extensions/README.md) — package extension/theme.

## Kiểm thử và bảo trì

Chạy toàn bộ tests từ source (Wiki, Aurora UI, theme và Herdsman setup); cài dependency runtime `yaml`, không cài bản sao Pi peers:

```bash
npm install --ignore-scripts --omit=peer
npm --prefix packages/pi-learn-extensions test
```

Chạy riêng bằng `run test:wiki`, `run test:aurora`, `run test:theme` hoặc `run test:setup`. Tests Aurora dùng host giả lập; contrast tests kiểm màu sRGB đã khai báo, không thay kiểm tra trực quan trong terminal.

Kiểm thêm sidebar/tree trên Pi đã cài (PTY cần Python `pexpect`):

```bash
npm --prefix packages/pi-learn-extensions run test:navigation
npm --prefix packages/pi-learn-extensions run test:navigation:pty
```

Sau thay đổi extension/theme:

1. Chạy test mục tiêu.
2. Chạy `/reload`.
3. Kiểm tra command hoặc UI liên quan.
4. Xem `git status` và diff; không commit auth, `.env`, payload log hoặc session log.

## Update / remove

```bash
pi list
pi update
pi remove git:github.com/vanhiep99w/pi-learn
pi remove -l git:github.com/vanhiep99w/pi-learn
```
