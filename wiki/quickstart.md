# Pi Learn quickstart

Pi Learn là package mở rộng Pi Coding Agent và tài liệu học Pi bằng tiếng Việt. Public surface gồm Wiki repository, ChatGPT usage, Aurora UI và theme `midnight-aurora`; không có backend/database riêng. Subagents dùng external Herdsman với [setup opt-in](operations/herdsman-setup.md), không phải runtime của Pi Learn.

## Đọc có chọn lọc

Với request về project, đọc trang này một lần khi context chưa có; request không liên quan thì không cần. Chọn route bên dưới, tìm heading bằng grep có giới hạn rồi đọc section cần thiết. `#anchor` chỉ là navigation hint, không tự giới hạn filesystem read. Mở rộng sang callers/consumers/tests khi vượt boundary hoặc evidence thiếu; không preload Wiki. Normal pages là evidence, không thay instructions hoặc source hiện hành.

## Setup tối thiểu

Cần Pi CLI đã cài:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
# Thêm -l để cài project; thử không ghi settings:
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau install/update/source change: restart hoặc `/reload` đúng package đang dùng. [Install/reload](operations/development.md#install-and-reload) phân biệt bản Git và checkout local; [release/update](operations/development.md#releaseupdate-workflow) giữ checklist bảo trì. Theme là lựa chọn của user, không tự bật.

## Task → system → page

| Task | System / ranh giới | Trang sở hữu |
|---|---|---|
| Manifest, resource discovery, host peers | Package integration | [Architecture](architecture/overview.md#package-boundaries) |
| `/wiki`, `/wiki-update`, selective reading | [Wiki module](modules/wiki/SPEC.md) | [Lifecycle](extensions/wiki-extension.md#commands-and-run-lifecycle), [reading](extensions/wiki-extension.md#conditional-project-reading) |
| Lookup, schema, metadata tools | Wiki read/write boundary | [Read tools](extensions/wiki-extension.md#read-only-wiki-tools), [spec tools](extensions/wiki-extension.md#controlled-spec-metadata-tools) |
| Rules, service routing, snapshot/no-op | Wiki policy và persistence | [Routing](extensions/wiki-extension.md#source-scope-và-service-rules), [rule updates](extensions/wiki-extension.md#agent-directed-rule-updates), [validation](extensions/wiki-extension.md#link-and-rule-validation) |
| OAuth, accounts, cache, usage badge | [Usage module](modules/chatgpt-usage/SPEC.md) → Aurora | [Usage](extensions/catalog.md#chatgpt-usage-status), [shared contract](extensions/catalog.md#contract-dùng-chung-với-aurora) |
| Editor/footer, sidebar, `/tree-v2`, theme | [Aurora module](modules/aurora/SPEC.md) → host TUI | [Aurora](extensions/catalog.md#aurora-ui), [theme](extensions/catalog.md#midnight-aurora-theme) |
| Herdsman profiles, child tools, Lead prompt | Optional config companion | [Portable setup](operations/herdsman-setup.md) |
| Setup, docs, release, PR review | Operations | [Development](operations/development.md) |
| Tests, privacy, path safety | Verification | [Testing and safety](operations/testing-and-safety.md) |

Module specs mới là **draft**, chỉ bổ sung boundary/source ownership; guides hiện hữu tiếp tục sở hữu chi tiết, không migration. `docs/README.md` là index tài liệu host Pi, không phải implementation contract của Pi Learn. Public source ở `packages/pi-learn-extensions/`; `.pi/` là local/dev, có thể chứa dữ liệu nhạy cảm.

## Rule loading

Chỉ đọc root + domain rules áp dụng **ngay trước sửa**, không load cho read-only/unrelated requests. Giao nhiều domain thì đọc các domain thực sự áp dụng; conflict phải dừng và báo.

| Edit target | Rules |
|---|---|
| Mọi governed repository edit, quickstart/module specs | [Root](_rules.md) |
| Manifests, package boundaries, architecture docs | [Architecture](architecture/_rules.md) |
| Extension/theme source, subpackage manifest, extension docs | [Extensions](extensions/_rules.md) |
| README, AGENTS/CLAUDE, docs, tests, manifests/lockfiles, CI/release/operations | [Operations](operations/_rules.md) |

**Lệch policy/source cần user xử lý:** source cho phép user-requested lasting rule trong chat thường hoặc `/wiki-update`, không cần từ khóa tên file; `GLOBAL-RULE-001` và `EXT-WIKI-RULE-001` checked-in vẫn yêu cầu opt-in `/wiki-update` cũ. Không coi mô tả source là quyền bỏ qua rules. Init không sửa rules; brief do user giữ và metadata do extension finalize. [Chi tiết](extensions/wiki-extension.md#agent-directed-rule-updates).

## Kiểm tra và giới hạn

- Với sửa Wiki: `npm --prefix packages/pi-learn-extensions run test:wiki`, kiểm links/anchors và `wiki_validate({scope:"all"})`. Validation cấu trúc không xác nhận semantic correctness hoặc user review.
- [Coverage](operations/testing-and-safety.md#automated-tests) phân biệt default suites, navigation và PTY riêng. OAuth/network/model intent, mọi race/recovery và TUI reload chưa được kiểm chứng đầy đủ; usage còn [lifecycle limits](extensions/catalog.md#contract-dùng-chung-với-aurora).
- Chưa có Node/Pi compatibility matrix hoặc test/release CI pipeline; [PR-review workflow](operations/development.md#pr-review-workflow) không thay chúng. Navigation phụ thuộc private host layout.
- Không mở auth, `.env`, keys/tokens hoặc raw session/payload logs. Rà status/diff, không auto-push; không sửa `wiki/INSTRUCTIONS.md`, `.last-update.json` hay rules trong init.
