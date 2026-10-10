# Pi Learn quickstart

Pi Learn là package Pi Coding Agent và repository học Pi bằng tiếng Việt. Public surface: Wiki repository, ChatGPT usage UI, Aurora UI và theme `midnight-aurora`. Không còn runtime session-observability/proposal/eval/apply, image-generation hoặc model-prompt tools.

## Khi nào đọc trang này

Request về project: đọc một lần nếu context hiện tại chưa có, không reload khi đã có. Request không liên quan: không cần đọc. Đây là entrypoint điều hướng, không preload toàn Wiki.

## Setup tối thiểu

Cần Pi CLI đã cài. Từ README:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
# Scope project: thêm -l; thử không ghi settings:
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau install/update/source change: restart Pi hoặc `/reload`. Chọn theme `midnight-aurora` trong settings nếu muốn dùng palette đi kèm. [Install/update và release](operations/development.md#install-and-reload) phân biệt bản Git đã cài với checkout local.

## Bản đồ project

| Vùng | Vai trò |
|---|---|
| `package.json` | Install target, expose resources của subpackage |
| `packages/pi-learn-extensions/` | Public extensions, theme, Wiki tests và package README |
| `docs/`, `PI_DOCUMENTATION.md` | Pi reference/hướng dẫn tiếng Việt; index `docs/README.md` |
| `wiki/` | Change routes và contracts của repository này |
| `.pi/` | Local/dev, không public package source; có thể chứa dữ liệu nhạy cảm |

[Architecture](architecture/overview.md#package-boundaries) ghi rõ manifests, host peers và entrypoints; không có backend/database/frontend build riêng.

## Rule loading

Chỉ load rules **ngay trước sửa** component/domain áp dụng; không load cho read-only question hoặc unrelated work. Root rule + domain tương ứng, không đọc tất cả domain. Nếu scope mở rộng thì load rule mới; chỉ re-read khi content mất sau compaction hoặc scope thay đổi. Rule conflict thì dừng và báo.

| Edit target | Rules |
|---|---|
| Mọi governed repository edit, quickstart/plan Wiki | [Root](_rules.md) |
| Manifests, package boundaries, architecture docs | [Architecture](architecture/_rules.md) |
| Extension/theme source, subpackage manifest, extension docs | [Extensions](extensions/_rules.md) |
| README, AGENTS/CLAUDE, docs, tests, manifests/lockfiles, CI/release/operations docs | [Operations](operations/_rules.md) |

Target giao nhiều domain thì đọc các rule thực sự áp dụng. Source hiện cho active `/wiki-update` sửa `wiki/**/_rules.md` theo intent: agent tự phân loại chính sách lâu dài và chọn domain, không cần tên file hay từ khóa; ngoài update rules vẫn protected. Extension có thể tạo deterministic scaffolds thiếu. Brief do người dùng giữ; metadata do extension finalize.

Migration còn lại: `GLOBAL-RULE-001` và `EXT-WIKI-RULE-001` trong các file rule checked-in vẫn mô tả opt-in cũ. Chúng chưa được sửa vì lượt source maintenance này không phải `/wiki-update`; cần cập nhật hai rule qua lệnh đó sau khi reload source mới để contract không mâu thuẫn.

## Commands

`/wiki [message]` khởi tạo; `/wiki-update [message]` cập nhật có chọn lọc. Dùng provider/model/tools hiện tại; prompt không inject Git context. Không có command hỏi Wiki riêng: project question theo bootstrap top-level.

Xem [lifecycle](extensions/wiki-extension.md#commands-and-run-lifecycle), [agent-directed rule updates](extensions/wiki-extension.md#agent-directed-rule-updates), [no-op](extensions/wiki-extension.md#no-op-behavior). Command usage/account và theme ở [catalog](extensions/catalog.md).

## Task routing

Dùng bounded grep tìm heading, rồi ranged read. `#anchor` chỉ navigation hint, không tự giới hạn filesystem read. Mở rộng sang caller/consumer/shared contract/tests khi topic vượt boundary hoặc evidence thiếu; dừng khi đã grounded.

| Change intent | Bắt đầu | Mở rộng khi |
|---|---|---|
| Package/manifest/entrypoint | [Package boundaries](architecture/overview.md#package-boundaries) | Resource discovery/install/compatibility đổi |
| Wiki commands/prompt/selective reading | [Wiki lifecycle](extensions/wiki-extension.md#commands-and-run-lifecycle) | Tool guard, metadata hoặc validation đổi |
| Rules/snapshot/links | [Wiki validation](extensions/wiki-extension.md#link-and-rule-validation) | Rule permissions, no-op hoặc settlement bị ảnh hưởng |
| ChatGPT usage/OAuth/accounts | [Usage](extensions/catalog.md#chatgpt-usage-status) | Credential adapters hoặc shared object đổi |
| Usage badge consumer | [Shared contract](extensions/catalog.md#contract-dùng-chung-với-aurora) | Producer, stale handling hoặc lifecycle đổi |
| Aurora editor/footer/Git/theme | [Aurora](extensions/catalog.md#aurora-ui) | Host layout/API, cleanup hoặc tokens đổi |
| Install/update/docs/release/CI | [Development operations](operations/development.md) | Package boundaries hoặc security boundary đổi |
| Tests/privacy/path safety | [Testing and safety](operations/testing-and-safety.md) | Owning component contract cần kiểm chứng |

## Vòng lặp thay đổi an toàn

1. Đọc source/focused tests khi Wiki cũ, thiếu hoặc mâu thuẫn; public source đặt dưới `packages/pi-learn-extensions/`.
2. Không đọc auth/.env/keys/tokens/payload hoặc raw session logs. File path trong docs không phải quyền mở live data.
3. Với UI: hasUI guard, cleanup session state, kiểm tra producer/consumer trước đổi fields.
4. Chạy `npm --prefix packages/pi-learn-extensions run test:wiki`; source/theme changes cần reload và manual UI checks.
5. Rà link/anchor/status/diff. Không tự sửa metadata, brief, rules trong normal Wiki run; xóa plan tạm, không auto-push.

## Backlog có evidence

- Có 39 automated Wiki tests, gồm command guards và permission lifecycle. Chưa kiểm đầy đủ snapshot/no-op/interrupted metadata, semantic classification bằng model thật hoặc OAuth/TUI. [Coverage và manual checks](operations/testing-and-safety.md#automated-tests).
- Aurora có host-mocked UI/headless tests và Midnight Aurora có contrast tests; chưa có integration tests trên TUI thật. Usage shutdown vẫn không clear global/cache/pending hoặc cancel details timeouts; cần focused lifecycle tests trước khẳng định an toàn mọi mode. [Catalog](extensions/catalog.md#aurora-ui).
- Không có declared Node/Pi compatibility matrix hoặc release/test CI pipeline; remote ChatGPT APIs và implementation external PR-review action chưa được xác minh trong Wiki run này. [Operations](operations/development.md#pr-review-workflow).
