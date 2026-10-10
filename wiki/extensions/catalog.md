# Extensions and theme catalog

Phạm vi: resources public trong `packages/pi-learn-extensions/`, ownership và luồng tích hợp TUI. Đây là canonical contract ChatGPT usage ↔ Aurora; chi tiết Wiki ở [Wiki capability](wiki-extension.md). Không có server hoặc dịch vụ account của Pi Learn.

## Wiki

Entrypoint `packages/pi-learn-extensions/extensions/wiki/index.ts` đăng ký `/wiki` và `/wiki-update`. Agent hiện tại thực hiện tác vụ; command layer quản lý snapshot/validation/metadata. Xem [lifecycle](wiki-extension.md#commands-and-run-lifecycle), [agent-directed rule updates](wiki-extension.md#agent-directed-rule-updates) và [tests](../operations/testing-and-safety.md#automated-tests).

## ChatGPT usage status

Ownership toàn bộ ở `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts`: OAuth compatibility, account persistence, network usage, cache và producer của state Aurora đọc.

### Commands và provider gating

| Command | Tác dụng |
|---|---|
| `/chatgpt-login` | OAuth openai-codex, lưu và activate account |
| `/chatgpt-usage` | Hiện details, cho phép ready cache dưới 60 giây |
| `/chatgpt-usage-refresh` | Force fetch details |
| `/chatgpt-accounts` | Import current credential và liệt kê saved accounts |
| `/chatgpt-switch` | Chuyển vòng sang account tiếp theo; không có picker |
| `/chatgpt-delete` | Picker + xác nhận xóa một hoặc tất cả |
| `/chatgpt-logout` | Alias của delete, không mặc định xóa ngay |

Mọi command của extension này yêu cầu `ctx.hasUI`. Usage chỉ chạy khi model provider chính xác là `openai-codex` hoặc `chatgpt`; command account không yêu cầu provider hiện tại là ChatGPT và không tự đổi model. API-key OpenAI không phải subscription OAuth.

### Luồng usage và cache

`session_start` → `updateVisibility()` → `fetchUsage()`; `model_select` và `agent_end` force refresh khi provider phù hợp. Interval 60 giây refresh global state khi active provider là ChatGPT. Rời provider xóa global state/status/widget.

`loadChatGptOauth()` tìm lần lượt OAuth openai-codex trong Pi store, chatgpt trong Pi store, rồi openai trong OpenCode store. Token sắp hết hạn trong 30 giây được refresh bằng POST `https://auth.openai.com/oauth/token`, persist về store nguồn; usage GET `https://chatgpt.com/backend-api/wham/usage` gửi Bearer và `ChatGPT-Account-Id` nếu có.

`normalizeUsage()` nhận `rate_limit.primary_window`/`secondary_window`, map sang `fiveHour`/`weekly`; tên hiển thị dựa `limit_window_seconds`, không giả định API luôn trả 5 giờ/7 ngày. Phải có ít nhất một window có used_percent dạng number. Phần trăm round/clamp 0–100; remaining = 100 − used; reset_at là epoch giây, fetchedAt là epoch mili giây.

State module-level: idle, disabled (không OAuth), ready(snapshot), error(message, optional snapshot). Một promise `pending` gộp fetch đồng thời kể cả force; chỉ ready cache trẻ hơn 60 giây được reuse. Lỗi ngay sau ready giữ snapshot và đánh stale; lỗi liên tiếp khi cache đã error không tiếp tục giữ snapshot cũ. Fetch không có timeout/retry/abort riêng trong source; phiên request đang chạy không bị cancel bởi shutdown.

Details widget dưới editor tự ẩn sau 12 giây. Normal usage không tạo status/footer line trùng: cập nhật global state cho Aurora, xóa status/widget. Nếu không dùng Aurora, xem details bằng command.

### Account state và persistence

Credential record: type oauth, access, refresh, expires (mili giây), optional accountId/username. Saved account thêm accountId bắt buộc, label, addedAt, lastUsedAt; store gồm accounts và activeAccountId, upsert theo accountId. JWT claims được decode để lấy ID/tên, không phải bước xác minh chữ ký.

Các path dưới đây chỉ mô tả **source contract**, không yêu cầu mở dữ liệu thật:

- Pi store: `~/.pi/agent/auth.json`.
- Saved accounts: `~/.pi/agent/chatgpt-usage-accounts.json`.
- Fallback OpenCode: `$XDG_DATA_HOME/opencode/auth.json`, mặc định `~/.local/share/opencode/auth.json`.

Login ưu tiên legacy `modelRegistry.authStorage.login`; fallback `modelRegistry.runtime.login(provider, "oauth", callbacks)`. Write/delete credential cũng qua legacy storage hoặc runtime credentials; runtime refresh dùng allowNetwork false. Read có fallback file; write activate không âm thầm fallback nếu runtime API thiếu. Browser mở bằng `xdg-open` best effort, URL/device code vẫn hiện để nhập thủ công.

Switch import current openai-codex account, refresh saved token nếu cần, ghi credential openai-codex, cập nhật activeAccountId, reset cache rồi refresh usage. Không có account/chỉ một account thì notify. Delete active chọn account còn lại đầu tiên; hết account/xóa tất cả thì xóa cả credential openai-codex và chatgpt, reset cache/global. Delete không xóa OpenCode fallback: nếu fallback còn credential, usage có thể xuất hiện lại. Usage credential priority và active marker không phải cùng một nguồn dữ liệu tuyệt đối.

Ghi file extension dùng lock `.lock` exclusive `wx`, tối đa 100 lần thử cách 50 ms, loại lock cũ hơn 30 giây, dọn lock trong finally. Tạo directory mode 0700, file 0600 và best-effort chmod; không mã hóa credential và không có cross-file transaction. `readJson()` nuốt read/parse error thành `{}`: không được suy ra store thật sự trống, và write sau đó có thể mất dữ liệu không parse được.

### Contract dùng chung với Aurora

Producer `setGlobalUsage()` ghi `globalThis.__piChatGptUsageStatus`:

| Field | Contract |
|---|---|
| username | Optional; chỉ tên hiển thị, không token |
| fiveHour, weekly | Optional window: label, used, remaining, resetAt |
| stale | true khi đang hiện snapshot sau fetch error |
| updatedAt | snapshot fetchedAt, mili giây |

Consumer trong repository là `getChatGptUsageBadge()` ở Aurora. Không có evidence về consumer ngoài repo. Contract là object in-process, không schema version/export package/event bus; khi đổi field phải kiểm tra cả producer lẫn consumer.

Shutdown dừng interval, bỏ status/widget và active flag; source không xóa global/cache/pending ở hook này. Global được xóa khi đổi sang non-ChatGPT hoặc explicit delete path. Các timeout details/list accounts có catch stale UI nhưng không được tracking để cancel. Đây là giới hạn lifecycle cần kiểm tra sau reload/session replacement.

### Lỗi và thay đổi an toàn

Không OAuth: hướng dẫn login. HTTP usage/token lỗi, response thiếu window/token hoặc lock timeout: báo lỗi; details có thể hiện cached snapshot theo quy tắc trên. Không có bảo đảm remote endpoint ổn định hoặc tương thích mọi host version. Không log token/body OAuth; response token-refresh lỗi hiện có thể được đưa vào error message, nên không chia sẻ nguyên notification chưa rà soát.

Khi sửa auth adapter, kiểm tra legacy/runtime path và account switch thật trong môi trường riêng được người dùng cho phép. Chưa có focused automated tests cho component này; checklist ở [manual verification](../operations/testing-and-safety.md#chatgpt-usage-and-aurora).

## Aurora UI

Ownership `packages/pi-learn-extensions/extensions/aurora-ui.ts`: editor/footer, banner, badge context/model/thinking/session/cwd/Git, working message và theme picker. Theme resource riêng, không được bật tự động bởi banner.

### Lifecycle và rendering

`session_start` có hasUI guard: banner ẩn sau 5 giây, render tên/màu theme hiện tại qua component factory (không cache ANSI, cắt theo visible width), cleanup session cũng xóa banner; cài AuroraEditor (extends CustomEditor), footer, fetch Git status ngay và mỗi 2,5 giây. Footer subscribe branch change để refresh/render. `session_shutdown` chạy cleanup callbacks; footer dispose dọn timers/subscription, unregister cleanup; disposed flag ngăn render muộn. `refreshingGitStats` ngăn fetch overlap; không abort git request đang chạy.

Editor giữ content/autocomplete từ super.render(), thay viền trên/dưới, không viền dọc/góc, tối thiểu ba dòng content. Terminal fullscreen chuyển viền dưới sang hàng footer đã dành sẵn; mode khác vẽ dưới editor. Footer chỉ hiển thị extension statuses (bao gồm Wiki status). Width dùng visibleWidth để fit badges; width <20 chỉ còn rail, ưu tiên bỏ cwd khi chật; usage badge quá dài bị ẩn toàn bộ.

Đây là integration phụ thuộc layout `CustomEditor.render()` (tìm dòng rail bằng regex), `tui.mode` và footer APIs của host; cần kiểm tra khi nâng Pi, không chỉ test theme JSON. Theme fallback trả plain text khi ctx không còn hợp lệ.

### Inputs, Git và actions

- Context badge lấy getContextUsage; thinking lấy pi.getThinkingLevel; model/session từ ctx. Thiếu/stale API thường được catch để không crash rendering.
- Git dùng `pi.exec("git", ["-C", cwd, "status", "--porcelain=v1"], timeout 3000)`. Đếm added/modified/deleted/renamed/untracked/conflicted, không đọc file content hoặc log. Lỗi/non-repo trả null, bỏ badge; sạch hiển thị ✓. Badge stats gắn cùng branch nếu branch có sẵn.
- Viền dưới đọc [global contract](#contract-dùng-chung-với-aurora), không tự fetch auth/network. Màu theo remaining ≤5 error, ≤25 warning; stale thêm cached.
- `agent_start`/tool events đặt working message tiếng Việt; model_select notify provider/id; tool error notify thất bại. Các hooks có hasUI guard.
- `/aurora-themes` và `ctrl+shift+t` dùng getAllThemes/select/setTheme và có hasUI guard. Command không có UI in hướng dẫn chọn theme; shortcut không có UI bỏ qua. Picker không tự ghi settings trong extension và không đổi theme khi cancel.

Điểm mở rộng: tool label map, badge layout, footer statuses và theme tokens. Giữ cleanup, width bounds, autocomplete và [usage contract](#contract-dùng-chung-với-aurora) khi thay editor. `tests/aurora/aurora-ui.test.mjs` kiểm banner, live theme tokens, width, cleanup và headless picker với host giả lập; vẫn cần thử terminal hẹp/fullscreen thủ công.

## Midnight Aurora theme

Source `packages/pi-learn-extensions/themes/midnight-aurora.json`, public name `midnight-aurora`, schema URL của Pi. `vars` cung cấp palette; `colors` map accent/border/status, message/tool panels, Markdown/syntax/thinking và bashMode; `export` map page/card/info backgrounds. Không có runtime state hoặc credential trong theme.

Aurora lấy tokens từ theme đang active và banner hiển thị tên thực tế. Khuyến nghị `system` để dùng cơ chế sinh màu/tự thích nghi của Pi; extension không tự đổi theme người dùng. `theme: "midnight-aurora"` giữ palette riêng, khai báo appearance dark và dự kiến nền terminal gần `#0b1020` (không đổi nền terminal). Chữ phụ/status được tăng độ sáng theo hướng giữ hue/chroma, vùng chọn tối hơn để chữ dễ đọc. `tests/theme/midnight-aurora.test.mjs` kiểm WCAG ≥4.5:1 cho các cặp chữ/nền khai báo và phân cấp dim/muted/text; không bảo đảm trên nền terminal bất kỳ hoặc xấp xỉ 256 màu. Khi thêm token/đổi tên phải kiểm tra host schema, extension consumers và ví dụ settings; reload rồi thử picker và rendering. JSON parse/contrast tests không thay schema/visual validation.

## External web search

Pi Learn không đóng gói web tools. README hướng dẫn cài riêng `pi-web-access`; không coi đây là dependency bắt buộc hoặc entrypoint do repo duy trì. Xem [package boundaries](../architecture/overview.md#package-boundaries).
