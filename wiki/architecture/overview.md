# Architecture overview

Phạm vi: package boundaries, public entrypoints và ownership tài liệu. Đọc khi đổi manifest/resource discovery hoặc contract tích hợp. Evidence: hai manifests, hai README, `docs/README.md` và các entrypoint dưới `packages/pi-learn-extensions/extensions/`.

## Package boundaries

### Root package

`package.json` là install target Git trong README, name `pi-learn`, version 1.0.1, ESM, không private. Pi manifest expose:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

Không có workspace declaration, root scripts, application server, database hoặc frontend build pipeline trong manifest. Không coi thư mục packages là bằng chứng về monorepo services. Host Pi cung cấp `@earendil-works/pi-ai`, `pi-coding-agent`, `pi-tui` qua optional peers `*`; manifest không pin compatibility range hoặc Node engines. Node built-ins phục vụ filesystem/network/process.

### Public extension and theme package

`packages/pi-learn-extensions/package.json` name `pi-learn-extensions`, version 1.0.1, ESM; expose `./extensions`, `./themes`; files allowlist gồm extensions/tests/themes/README. Script `test:wiki` chạy Node test runner trên .mjs/.mts. Root không có files allowlist giống subpackage; kiểm tra packaging thật trước release, không suy ra artifact hai package giống nhau.

Public entrypoints:

- `extensions/wiki/index.ts` → đăng ký commands và lifecycle Wiki.
- `extensions/chatgpt-usage-status/index.ts` → account commands, usage producer.
- `extensions/aurora-ui.ts` → editor/footer, usage consumer, theme picker.
- Theme resource: `themes/midnight-aurora.json`.

Các path trên tương đối với `packages/pi-learn-extensions/`. Helper Wiki không là standalone extension. Khi đổi manifest/path cần giữ root và subpackage cùng trỏ vào source thật; không import private/removed sibling runtimes.

### Documentation areas

| Vùng | Ownership và vai trò |
|---|---|
| `README.md`, package README | Install, commands và thao tác người dùng |
| `docs/` | Hướng dẫn Pi tiếng Việt, index `docs/README.md`; không phải code implementation của Pi Learn |
| `PI_DOCUMENTATION.md` | Tham khảo tổng hợp ở root |
| `wiki/` | Repository-specific change routes, contracts và validation |
| `wiki/INSTRUCTIONS.md` | Brief do người dùng giữ; extension chỉ đọc |
| `wiki/**/_rules.md` | Scoped rules; agent chọn owner theo intent trong active `/wiki-update` |
| `wiki/.last-update.json` | Metadata do extension finalize |

Các hướng dẫn host trong docs không thay evidence source khi xác định hành vi extension. Không mirror docs vào Wiki; [operations](../operations/development.md#documentation-workflow) chỉ dẫn cập nhật đúng lớp.

## Runtime loading model

README package và `docs/PI_PACKAGES_GUIDE.md` mô tả Pi load direct TS/JS và subdirectory có index từ extension manifest. Source Wiki index import `wiki-commands.js` trong khi source là `.ts`: đây là host TS loader contract, không có compile-to-dist script ở repo. Tests .mts cũng dựa Node hỗ trợ thực thi TypeScript; version tối thiểu chưa được khai báo.

Luồng chính:

| Producer / entry | State owner / xử lý | Consumer / output |
|---|---|---|
| `/wiki`, `/wiki-update` | commands giữ active run, prompt giao agent sửa docs | Wiki files → validators → extension metadata/status |
| Pi session/model/agent events, usage commands | ChatGPT extension giữ OAuth/account stores, cache/pending | Global usage object → Aurora; details widget |
| Session/tool events, Git porcelain | Aurora session timers/editor/footer | Terminal rails, badges, working messages |
| Pi theme selection | Host theme registry đọc JSON | Aurora và các renderer host dùng color tokens |

Chi tiết state/persistence/failure không lặp ở đây: [Wiki](../extensions/wiki-extension.md#commands-and-run-lifecycle), [usage contract](../extensions/catalog.md#contract-dùng-chung-với-aurora), [Aurora](../extensions/catalog.md#aurora-ui). Không có backend chung, inter-service protocol hoặc persisted usage history; shared usage object chỉ sống trong process. External consumers chưa được biết từ repo.

Extension code chạy trong process Pi với quyền OS của user, không sandbox. UI hooks phần lớn hasUI-guarded nhưng theme command/shortcut hiện có gap; xem [catalog](../extensions/catalog.md#inputs-git-và-actions). Session cleanup và compatibility phải xác minh trên host thật.

## Reduced supported surface

Scope hiện hành là Wiki, ChatGPT usage, Aurora UI và theme. README và Git commit `5d753dd` ghi retirement session-observability/proposal/eval/apply, image generation và model-prompt tools; manifest/source inventory hiện không expose chúng. Không coi compatibility với subsystem đã bỏ là yêu cầu ngầm. Web tools cài riêng, không bundled.

## Source-of-truth table

| Thay đổi | Source chính | Contract / validation |
|---|---|---|
| Package resources | hai package.json | Entrypoint discovery, install/reload |
| Wiki command/prompt | `packages/pi-learn-extensions/extensions/wiki/wiki-commands.ts`, `wiki-prompt.ts` | [Wiki lifecycle](../extensions/wiki-extension.md), prompt tests |
| Rule/link validators | cùng thư mục Wiki: `wiki-rules.js`, `wiki-links.js` | [Validation](../extensions/wiki-extension.md#link-and-rule-validation), focused tests |
| ChatGPT/Aurora | `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts`, `aurora-ui.ts` | [Catalog](../extensions/catalog.md), manual checks |
| Theme tokens | `packages/pi-learn-extensions/themes/midnight-aurora.json` | JSON/schema/render checks |
| Install/update/release | README, manifests, `.github/workflows/ocr-review.yml` | [Operations](../operations/development.md) |

## Local-only boundary

`.pi/` là local/dev và có thể chứa dữ liệu nhạy cảm; không phải public package source. Không cần đọc auth, payload/session logs hoặc config local để hiểu package. `.gitignore` chỉ liệt kê `.pi/teams`, `.pi-subagents/`, `node_modules/`, không phải bảo đảm mọi secret đã được ignore. Thay đổi public đặt dưới `packages/pi-learn-extensions/`; [privacy và Git hygiene](../operations/testing-and-safety.md#git-hygiene) áp dụng trước share/commit.
