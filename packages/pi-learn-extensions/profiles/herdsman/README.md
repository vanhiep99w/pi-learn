# Portable Herdsman profile

Đây là cấu hình Pi Learn được người dùng chọn, không phải defaults của Herdsman. Templates được version-control; generated config trên từng máy không được commit. Mọi thay đổi Herdsman tiếp theo của profile này nên sửa tại đây trước, rồi chạy lại setup.

## Profile gồm gì?

- `profile.json`: roster sáu bundled agents, `maxAgentDepth: 1`, extension resources và web tools.
- `flexible-lead.md`: prompt bổ sung cho Flexible Lead, ưu tiên paths/symbols để child tự đọc source local; vẫn giữ required evidence/results và kiểm tra đúng checkout/cwd. Đây là behavioral guidance, không hard-block file embedding.
- `../../scripts/setup-herdsman.mjs`: installer tường minh; không được đăng ký vào Pi manifest, không chạy khi package load/reload.

Setup tạo/merge vào resolved Pi agent directory:

```text
<agentDir>/
├── pi-herdsman/config.json         # maxAgentDepth: 1; giữ keys khác
├── coordinators/flexible-lead.md   # managed prompt block; giữ custom body
└── agents/
    ├── scout.md
    ├── researcher.md
    ├── implementer.md
    ├── reviewer.md
    ├── validator.md
    └── generalist.md
```

Agent overlays dùng array additions (`+...`) để load `pi-tool-display` và `pi-web-access`, thêm `web_enable`, `web_search`, `fetch_content`, `get_search_content`, `source_check` khi chưa được inherited tools cung cấp. Không copy bundled prompt, không pin model/thinking, không đổi ordinary tools, skills hoặc delegation allowlists. `pi-tool-display` là renderer, không thêm callable tool tên `display`.

`maxAgentDepth: 1` giữ direct delegation từ Lead nhưng không cho child tạo grandchildren; không phải concurrency/token/cost cap. Không sửa `orchestrator-lead`, project/private overrides hoặc child đang chạy.

## Setup nhanh trên máy mới

Cài Node.js, Pi CLI và Herdr TUI trước. Schema/config tham chiếu được kiểm tra với Herdsman 0.47.1, tool-display 0.5.0, web-access 0.47.0; đây không phải cam kết mọi phiên bản tương lai đều tương thích.

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
pi install npm:pi-herdsman
pi install npm:pi-tool-display
pi install npm:pi-web-access
herdr integration install pi
```

Từ checkout Pi Learn (hoặc dùng `npm --prefix /absolute/path/to/pi-learn ...`):

```bash
npm run setup:herdsman -- --dry-run
npm run setup:herdsman
```

Với Git install mặc định trên Linux/macOS, có thể chạy trực tiếp:

```bash
npm --prefix "$HOME/.pi/agent/git/github.com/vanhiep99w/pi-learn" run setup:herdsman -- --dry-run
npm --prefix "$HOME/.pi/agent/git/github.com/vanhiep99w/pi-learn" run setup:herdsman
```

Dùng `pi list` để lấy checkout thật nếu install/agent dir khác. Trên Windows dùng path tương ứng trong PowerShell. Nếu clone repo trực tiếp thay vì `pi install`, cài runtime dependency `yaml` trước: `npm install --ignore-scripts --omit=peer`.

Sau setup, restart hoặc `/reload` Pi cha **bên trong Herdr**, chọn `/lead flexible` và kiểm tra `/herdsman → Definitions`. Spawn child mới để kiểm tra renderer và web tools. Script không gọi provider hoặc chạy agent để test. Web vẫn cần network/provider configuration phù hợp; setup không copy keys/OAuth/settings từ máy cũ.

## Resolve paths và tuỳ chọn

```bash
node packages/pi-learn-extensions/scripts/setup-herdsman.mjs --help
npm run setup:herdsman -- --agent-dir /absolute/path/to/pi-agent --dry-run
npm run setup:herdsman -- --packages-dir /absolute/path/to/node_modules
```

- Agent dir: `--agent-dir` → `PI_CODING_AGENT_DIR` → `~/.pi/agent`; hỗ trợ `~`, local `file://` URLs và path có spaces.
- Mặc định tìm ba packages dưới `<agentDir>/npm/node_modules/`. `--packages-dir` đổi nơi lookup packages, không đổi agent dir.
- Không đọc Pi `settings.json`, auth stores, `.env`, credentials hoặc session logs. Không tự install packages, integration, gọi network hay sửa package settings.
- Resolve extension entrypoints trên từng máy; không hard-code home directory hoặc copy absolute paths từ máy khác. Giữ package được cài tại chỗ; nếu đổi install location, rà generated overlays trước khi setup lại.
- Chạy lại setup để áp dụng config/prompt mới từ profile. Chỉ phần prompt giữa markers `pi-learn:local-source-delegation` được quản lý; phần ngoài markers và agent prompt bodies được giữ nguyên. Prompt cá nhân cũ trùng hoàn toàn template được nhận vào managed block để không bị duplicate.

## Existing config và safety

Nên đóng/để Pi idle và xem `--dry-run` trước khi ghi. Script preflight toàn bộ tám targets, kiểm tra JSON/YAML và so nội dung trước khi ghi. Không rewrite file nếu output không đổi; config JSON đã có đúng giá trị giữ nguyên formatting/mtime. YAML comments và agent body bytes được giữ, nhưng formatting frontmatter có thể được chuẩn hoá.

- Giữ keys JSON khác, fields model/thinking/tools/skills khác và custom prompts; `maxAgentDepth` chủ động đặt lại thành `1` theo profile.
- Refuse symlinks (kể cả dangling), symlink ancestors, hardlinked/nonregular targets và text quá 1 MiB. Không tự xoá hoặc migrate definitions cũ có `max_turns`/`inherit_project_context` hay `tools` dạng scalar; sửa schema trước rồi chạy lại. YAML merge keys (`<<`, kể cả `!!merge`) bị từ chối, cần flatten fields trước để không vô tình thay effective policy qua anchors/merges.
- Explicit deny policies xung đột với web tools (`noTools`, `tools: []`, negative modifiers hoặc `excludeTools`) bị báo lỗi thay vì âm thầm mở quyền. Tool selectors được normalize comma/whitespace theo Herdsman; `excludeTools` được compose với bundled exclusions theo array modifiers trước khi kiểm tra effective conflicts. Extension removal xung đột với hai resources cần thêm cũng bị từ chối.
- Ghi thay thế từng file qua temp + rename cùng directory; **không phải transaction cho cả tám files**, không bảo đảm chặn mọi external-editor race hoặc crash/power-loss. Nếu I/O lỗi giữa chừng, một số file có thể đã đổi; sửa nguyên nhân rồi chạy lại.
- Script không xoá file/extension cũ, không xoá backups, không sửa `AGENTS.md`/`CLAUDE.md`, không cài orchestration engine. Runtime ThinkRail subagents đã bị xóa khỏi Pi Learn; chỉ external Herdsman quản lý children. Project/private Herdsman overlays có thể override global config; dùng Definitions UI kiểm tra effective values.
- Extensions chạy với quyền OS của Pi, không sandbox. Web queries có thể rời máy; fetch có thể tạo cached/cloned resources. Load renderer/web vào child không đồng nghĩa clone mọi parent hooks hoặc permissions.

Không đưa generated runtime/mailboxes/auth vào profile. Không thêm config kiểu `maxConcurrentAgents` nếu schema upstream chưa hỗ trợ.
