# Development operations

Phạm vi: cài đặt, vòng lặp thay đổi, cập nhật docs/package, release và PR review. Evidence: README root/package, hai manifests/lockfiles, `docs/README.md`, `.github/workflows/ocr-review.yml`. Đây là checklist bảo trì, không mô tả một release pipeline chưa tồn tại.

## Install and reload

Cần Pi CLI đã cài; repo là package extension/theme, không có app build hoặc server cần khởi động.

```bash
# Global; thêm -l để cài scope project
pi install git:github.com/vanhiep99w/pi-learn@main
# Thử trong session, không ghi settings
pi -e git:github.com/vanhiep99w/pi-learn@main
# Khi muốn test source local thay vì bản Git đã cài
pi -e ./
```

README có đầy đủ global/project install và remove. `docs/PI_PACKAGES_GUIDE.md` giải thích local paths/scopes/pinning. Sau sửa extension/theme, `/reload` hoặc restart Pi rồi thử affected surface; reload một bản Git đã cài không tự chuyển sang checkout local. Tránh load hai bản package cùng lúc gây command/UI trùng.

Nếu không thấy command/theme, kiểm tra `pi list`, resource selection bằng `pi config`, install scope và manifest paths; sau đó reload. Phiên không UI không thể kiểm chứng editor/dialog. Theme cần chọn trong settings hoặc picker, banner không tự bật theme.

## Package manifests and versions

Hai manifests version hiện 1.0.1, cùng expose resources nhưng path relative khác nhau. Xem [package boundaries](../architecture/overview.md#package-boundaries) trước sửa. Giữ versions đồng bộ khi chủ động release; host packages là optional peers `*`, không bundled runtime dependencies.

`package-lock.json` v3 có root package version/peers; `bun.lock` cũng mô tả optional peers, packages rỗng. Không có root test/build scripts, engines hoặc release automation trong manifests. Test .mts cần Node hỗ trợ TypeScript hiện dùng; chưa có minimum-version declaration, không hứa mọi Node/Pi version chạy được. Dùng package manager có chủ đích, rà lockfile diff, không regenerate cả hai chỉ để đổi format.

## Public source map

Chọn owner ở [architecture source table](../architecture/overview.md#source-of-truth-table), rồi đọc contract tương ứng:

| Intent | Canonical contract |
|---|---|
| Command/prompt, rules, snapshot, metadata | [Wiki capability](../extensions/wiki-extension.md) |
| Usage/OAuth/account hoặc badge dùng chung | [ChatGPT usage](../extensions/catalog.md#chatgpt-usage-status) |
| Editor/footer/Git/theme picker | [Aurora](../extensions/catalog.md#aurora-ui) |
| Palette và tokens | [Theme](../extensions/catalog.md#midnight-aurora-theme) |

Giữ ESM/TypeScript style gần source; helper Wiki giữ trong thư mục Wiki. Chạy focused tests rồi interactive checks; dùng [testing guide](testing-and-safety.md), không coi pass prompt tests là runtime integration pass.

## Documentation workflow

README là user command/setup contract; `docs/` và `PI_DOCUMENTATION.md` là tài liệu học host Pi; Wiki là kiến trúc/change routes riêng repo. Không sao chép toàn văn reference docs. `docs/README.md` nhóm quickstart/use, config/models, extensions/packages/themes/TUI/tools, sessions, SDK/RPC/JSON, platform và development; ngày sync trong index là claim của tài liệu, không phải kết quả kiểm tra upstream trong run này.

Khi source đổi:

1. Đi từ producer/owner tới consumer/shared contract và failure path; kiểm chứng focused tests.
2. Sửa canonical topic trước; README command/path phải đồng bộ. Thêm/xóa indexed docs thì cập nhật `docs/README.md`.
3. Chỉ đổi quickstart khi route/ownership/setup/backlog thay đổi. Nội dung detailed giữ ở topic page.
4. Với Wiki run, dùng plan tạm, giữ brief/rules/metadata đúng owner; rules chỉ sửa qua explicit `/wiki-update` opt-in. Chi tiết [workflow](../extensions/wiki-extension.md#documentation-workflow).
5. Kiểm tra link/anchor, rule layout, bootstrap và diff. Không sửa metadata bằng tay để giả completed.

AGENTS/CLAUDE hiện có đúng một compact Project Wiki section khớp prompt test. Chúng chỉ điều hướng agent, không chứa toàn bộ docs hay yêu cầu read rules cho câu hỏi read-only.

## Release/update workflow

Người dùng bản `@main`: `pi list` → `pi update` → restart hoặc `/reload` → smoke check. Pinned version/tag có quy tắc update riêng trong `docs/PI_PACKAGES_GUIDE.md`; không mặc định mọi install đều tracking main. Remove global/project theo README không phải thao tác xóa credential/account của ChatGPT extension.

Checklist trước tag/publish (hướng dẫn bảo trì, không command tự động của repo):

1. Chạy [automated checks](testing-and-safety.md#automated-tests), kiểm tra JSON theme; reload và thử command/UI affected trên host mục tiêu.
2. Đồng bộ hai versions/manifests và lock metadata bị ảnh hưởng; giữ public theme name/entrypoints hoặc ghi rõ migration.
3. Kiểm tra README/routes/contract và nội dung artifact dự kiến, đặc biệt root không có files allowlist như subpackage. Đừng đóng gói local state/secrets.
4. Rà git status/diff; không commit plan tạm hoặc dữ liệu riêng.
5. Chỉ tag/publish/push khi được yêu cầu rõ. Repo chưa có evidence npm publish target, changelog policy hoặc automated release job; không tự suy ra từ private false.

## PR review workflow

Workflow duy nhất trong `.github/workflows/` đã inventory là `ocr-review.yml` (OpenCodeReview PR Review), **không phải test/release CI**.

- Trigger pull_request_target opened/synchronize/reopened; hoặc issue_comment created trên PR từ user không Bot, association MEMBER/OWNER/COLLABORATOR, body bắt đầu `/open-code-review` hoặc `@open-code-review`.
- Concurrency theo PR, cancel-in-progress; job ubuntu-latest, timeout 30 phút; permissions contents read và pull-requests write.
- Với comment, github-script@v7 lấy base_ref/head_sha; action review pinned SHA `c89282f4dbaac2586c460a7a26684719e4be6887`, ocr_version 1.9.0, output language English.
- Inputs từ secret names OCR_LLM_URL/OCR_LLM_AUTH_TOKEN và variable names OCR_LLM_MODEL/OCR_LLM_USE_ANTHROPIC. Không đọc hoặc ghi giá trị secret vào docs.

Comment source nói action dùng trusted base và chỉ đọc PR git objects/diffs để dùng pull_request_target an toàn; implementation action bên ngoài chưa được inspect ở run này. Do trigger có quyền truy cập secrets, khi sửa workflow phải audit checkout/execution boundary thay vì tin comment là bảo đảm. Không tự chạy code PR không tin cậy với secret. Lỗi remote/action cần xem diagnostic đã redact; Wiki không biết cấu hình live hoặc kết quả review thực tế.

## Local-only files

`.pi/` là local/dev, không public source; `.codex/`/`.agents/` không được expose trong Pi manifest. Không cần mở cấu hình cá nhân để bảo trì package. Payload/session/auth files không phải test fixtures; xem [privacy](testing-and-safety.md#security-and-privacy). Không auto-push hoặc xử lý unrelated local changes.
