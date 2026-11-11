# ThinkRail subagents/delegation (vendored)

Nguồn: `JetBrains/thinkrail`, commit `883affb98416fddd2d8c4f7f18fba92cc435cb4b`, hai packages `pi-subagents` và `pi-delegation`. Cả hai private tại snapshot này, nên không dùng npm dependency hoặc mang toàn bộ ThinkRail server/UI sang. License **Apache-2.0** giữ tại `LICENSE`; `ORIGIN.json` lưu SHA-256 từng file gốc. `package.upstream.json` chỉ là reference, không đăng ký package/entrypoint phụ. Không đổi license code upstream sang MIT của Pi Learn.

## Reuse / adapter / gap

- **Reuse nguyên:** toàn bộ parser/discovery precedence, built-in agent definitions, model/thinking mapping, completion batching, concurrency semaphore, child-session driver, usage/status/lifecycle, storage/history helpers và tám test files upstream. Public tools vẫn `Agent` + `get_subagent_result`; không tạo engine tương đương thứ hai.
- **Bốn patch leaves:** local import sang sibling delegation barrel trong `pi-subagents/src/extension.ts` và `mapping.ts`; `extension.ts` thêm optional discovery hook và clear pending flush timer khi dispose; `definitions.ts` thêm optional definition-reader hook; `pi-delegation/src/service.ts` emit child extension shutdown trước dispose cho parent-owned children, không chỉ resource-owned children. Diff trong `pi-learn.patch`. Defaults/parser/precedence/tests gốc giữ nguyên.
- **Adapter Pi Learn:** `../../adapter.ts` bind mỗi extension instance với parent/cwd, intersect child tools với active parent + curated SDK/Wiki tools, không cấp quyền mutation Wiki của parent. `../../definitions.ts` dùng reader bounded/no-symlink và map spec-tool names sang Wiki cho builtins, không thay parser upstream. `../../model-bridge.ts` tạo runtime in-memory chuyển request qua public parent registry: không copy/đọc credentials hoặc dùng private runtime field. Wiki guard được share từ Wiki owner, không nhân đôi permissions engine.
- **Lý do adapter:** vanilla Pi không có ThinkRail host cung cấp runtime, curated child factories, lifecycle ownership hoặc UI controls. Upstream fallback tự tạo file-backed model runtime không giữ runtime-only auth của parent; bridge dùng public API thay vì đọc auth stores. Không thêm dependency runtime ngoài host peers/yaml đã có.

## Kiểm thử

```bash
npm --prefix packages/pi-learn-extensions run test:subagents
# Cần Bun + Pi đã cài, không model/auth thật:
npm --prefix packages/pi-learn-extensions run test:subagents:upstream
npm --prefix packages/pi-learn-extensions run test:subagents:host
```

Runner upstream copy source/tests sang temp directory, nối host peers từ Pi đã cài bằng symlinks, dùng isolated agent directory + offline mode, chạy 186 tests gốc không sửa. SDK tests dùng Faux responses và in-memory credential stores; generated fixture transcripts không phải user session logs. Node adapter tests không cần cài peers. Host smoke kiểm actual loader, provider loop, runtime-only auth bridge, context/tool separation, Wiki guard và background completion. Không coi đó là kiểm TUI thật, network providers hoặc mọi host/OS.

## Cập nhật upstream

1. Chọn cùng commit cho cả hai packages; kiểm public exports, SDK compatibility, license/NOTICE và dependency closure.
2. So code/tests với `originalSha256`, reapply/review bốn patches (bỏ hook nếu upstream đã có tương đương).
3. Không sửa tests upstream để làm adapter pass; cập nhật pin/hashes/patch cùng nhau.
4. Chạy adapter, upstream, strict typecheck, host và installed-artifact smoke trước rollout. Không đọc user auth hoặc transcripts để test.
