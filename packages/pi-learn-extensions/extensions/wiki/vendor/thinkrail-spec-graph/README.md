# ThinkRail Spec Graph core (vendored)

Nguồn: `JetBrains/thinkrail`, commit `519286befe0f15cc2dd270e251ecd8cdb9d0a01c`, thư mục `packages/spec-graph/core/`. Code và tests upstream giữ license **Apache-2.0** trong `LICENSE`; không đổi chúng sang MIT của Pi Learn. Repository upstream không có root NOTICE tại commit này. `ORIGIN.json` lưu nguồn và SHA-256 bản gốc; `package.upstream.json` chỉ là manifest tham khảo, không phải package/extension được đăng ký.

## Reuse / adapter / gap

- **Reuse:** parser/frontmatter, graph/reverse adjacency, search, graph traversal, structural validation và tests gốc. `graph.ts`, `query.ts`, `validate.ts`, `core.test.ts` không sửa; parser chỉ thêm log-level option, không viết lại dialect.
- **Patch tối thiểu:** `core/store.ts` thêm opt-in `includePath`, `readContent`, `onError`, `verifyContent`, `retainNonSpecs` và `documentEntries()`; lỗi stat loại cache cũ. `core/index.ts` export các types bổ sung. `core/parse.ts` dùng YAML `logLevel: "error"` để không emit warnings chứa source excerpt; parse errors vẫn throw vào catch như upstream (không dùng silent vì nó bỏ qua errors). Adapter trả warning diagnostic đã sanitize. Bộ tests upstream vẫn pass. Diff có trong `pi-learn.patch`.
- **Adapter Pi Learn:** `../../wiki-model.ts` dùng public barrel `core/index.ts`, không import leaves. Nó giới hạn Wiki root/exclusions, đọc regular files có giới hạn và kiểm UTF-8, bổ sung schema diagnostics trước lossy coercion, giữ guides ngoài graph và từ chối canonical lookup khi ID trùng. Content được kiểm lại mỗi read, kể cả cùng mtime/size.
- **Gap cần làm riêng:** upstream mặc định quét project, bỏ qua parse/I/O errors và chọn node đầu khi ID trùng; không đáp ứng reserved resources/diagnostics của Wiki. Đây là lý do thêm hooks và adapter, không viết lại graph engine.

Chỉ vendor pi-free core và tài liệu/manifest liên quan, không load nguyên upstream tools ghi, extension entrypoint, skill injection, server hoặc UI. `wiki/index.ts` vẫn là public Wiki entrypoint duy nhất. Sáu read tools `wiki_*` được wire qua `../../wiki-tools.ts`; adapter này áp dụng schema/registration patterns của upstream tools, giữ Apache-2.0 và notice thay đổi ngay trong file. Không dùng nguyên upstream shared wrapper vì nó cache toàn cục theo project root và ghi full output ra temp files, không đáp ứng Wiki scope/lifecycle/output budget. `../../wiki-validation.ts` reuse validators Wiki hiện có qua read hooks an toàn. Command no-op/finalization dùng graph/schema validation qua model này. `../../wiki-spec-writer.ts`/`../../wiki-mutation-tools.ts` adapt create/update mapping, scaffold và serialize/edit APIs upstream, thêm opaque active-run permit, stricter authoring, expected revision và Pi file/repository queues. Không copy raw upstream writes thiếu các guards đó. Các adapters ghi giữ Apache-2.0/source notices. Không có migration hoặc delete tool.

## Các gap mới không có ở snapshot upstream

`spec_get` upstream chỉ metadata; Wiki thêm explicit section retrieval dùng shared `wiki-headings.js` với link validation, không thêm Markdown engine song song. `source-paths` là field riêng được upstream parser/serializer giữ như unknown metadata; literal matcher/schema thuộc adapter, list update dùng upstream cho base fields rồi một YAML-AST edit cho field này. `wiki-policy.js` là opt-in policy-domain config/resolver riêng vì upstream core không sở hữu Wiki rules/scaffold/permissions. Không patch thêm vendor core/tests cho ba capability này; adapter và tests vẫn pin cùng snapshot trên.

## Kiểm thử

Từ root repository:

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
# Cần Bun; chạy tests upstream nguyên bản, tách khỏi Node suite:
npm --prefix packages/pi-learn-extensions run test:wiki:upstream
# Cần Pi đã cài; loader/TypeBox thật với fixture headless, không provider/auth:
npm --prefix packages/pi-learn-extensions run test:wiki:host
```

Tests upstream có conditional skips cho filesystem/Windows. Node suite có fixtures cho hooks/adapter và kiểm hash các files không patch. Tests này không chứng minh host TUI, mọi OS hoặc mọi phiên bản Pi đã tương thích.

## Cập nhật upstream

1. Chọn commit mới, kiểm exports, dependency `yaml`, license/NOTICE và source/tests tại chính commit đó.
2. So với hashes gốc trong `ORIGIN.json`; cập nhật core và tests từ cùng một commit, không sửa tests gốc để làm adapter pass.
3. Reapply/review ba patch leaves (bỏ patch khi upstream đã có API phù hợp), cập nhật `pi-learn.patch` và provenance. Không import private leaves từ adapter.
4. Chạy upstream suite, Node adapter suite, full package tests và packaging smoke. Khi tools được wire vào host, bổ sung `/reload`/headless/manual checks trước khi claim rollout hoàn tất.
