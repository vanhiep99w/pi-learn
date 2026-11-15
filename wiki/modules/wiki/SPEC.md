---
id: pi-learn-wiki
type: module-design
status: draft
title: Tích hợp Wiki repository
source-paths: [packages/pi-learn-extensions/extensions/wiki/, packages/pi-learn-extensions/tests/wiki/]
---

# Tích hợp Wiki repository

## Trách nhiệm và ranh giới

Module nối lệnh tạo/cập nhật tài liệu và tools Wiki với session Pi hiện tại. Nó sở hữu trạng thái run theo extension instance, chỉ mục đọc và quyền ghi metadata spec; agent/model hiện tại vẫn thực hiện nghiên cứu và sửa prose. Đây không phải provider riêng, bộ điều phối child agents hay filesystem sandbox.

Entrypoint duy nhất là `packages/pi-learn-extensions/extensions/wiki/index.ts`. Manifest dùng đường dẫn tường minh; helpers và vendored Spec Graph core không được đăng ký như extensions riêng. [Topology package](../../architecture/overview.md#package-boundaries) sở hữu contract discovery.

## Hợp đồng cho người dùng và coding agent

[Wiki capability](../../extensions/wiki-extension.md) tiếp tục là nơi giải thích chuẩn, không chuyển đổi guide cũ thành spec:

| Cần thay đổi/tra cứu | Hợp đồng sở hữu |
|---|---|
| Commands, active run, settlement và lỗi | [Lifecycle](../../extensions/wiki-extension.md#commands-and-run-lifecycle) |
| Lookup có giới hạn, section, revision và source owners | [Read tools](../../extensions/wiki-extension.md#read-only-wiki-tools) |
| Tạo draft, sửa frontmatter và concurrency | [Spec metadata tools](../../extensions/wiki-extension.md#controlled-spec-metadata-tools) |
| Service rules, selective reading và intent policy | [Routing](../../extensions/wiki-extension.md#source-scope-và-service-rules), [rule updates](../../extensions/wiki-extension.md#agent-directed-rule-updates) |
| Snapshot, metadata, validation và no-op | [Persistence](../../extensions/wiki-extension.md#snapshot-and-metadata), [no-op](../../extensions/wiki-extension.md#no-op-behavior) |

## Điểm kiểm chứng khi thay đổi

- `registerWikiCommands` trong `packages/pi-learn-extensions/extensions/wiki/wiki-commands.ts` sở hữu run. Theo luồng command → prompt/agent → `agent_settled`, không coi `agent_end` là hoàn tất; kiểm tra retry, shutdown và thu hồi quyền trước finalize.
- `WikiReadModel` trong `packages/pi-learn-extensions/extensions/wiki/wiki-model.ts` và `WikiSpecWriter` trong `packages/pi-learn-extensions/extensions/wiki/wiki-spec-writer.ts` là hai phía đọc/ghi. Khi đổi schema hoặc source ownership, kiểm tra cả consumer tools và queued writes; graph hợp lệ không chứng minh ownership đầy đủ hoặc nội dung đúng.
- `packages/pi-learn-extensions/tests/wiki/wiki-commands.test.mjs`, `wiki-tools.test.mjs`, `wiki-spec-writer.test.mts` kiểm lifecycle/permits/concurrency bằng fixtures. [Testing guide](../../operations/testing-and-safety.md#automated-tests) sở hữu commands và giới hạn kiểm thử.

Rationale đã được ghi trong README/source: giữ provider/tools hiện tại và giữ nguyên legacy guides; Spec Graph bổ sung lookup/metadata có kiểm soát, không tự migration hoặc review approval. Chưa xác minh hành vi phân loại intent bằng model thật, mọi race/I/O failure hoặc TUI `/reload`; không suy từ fixtures rằng các trường hợp đó đã an toàn.
