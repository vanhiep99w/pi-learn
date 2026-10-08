# Wiki capability

Phạm vi: command, prompt, đọc chọn lọc, rule opt-in, validation và metadata của `packages/pi-learn-extensions/extensions/wiki/`. Extension chạy trong Pi hiện tại; không tạo provider/model hay bộ filesystem tools riêng.

## Commands and run lifecycle

Public commands chỉ có `/wiki [message]` (khởi tạo) và `/wiki-update [message]` (bảo trì có chọn lọc). Không có alias init/ask/status hay command hỏi Wiki riêng.

Luồng trong `wiki-commands.ts`:

1. `registerWikiCommands()` nhận args và `ctx.cwd`; từ chối khi `ctx.isIdle()` false.
2. Update không có message chạy kiểm tra [no-op](#no-op-behavior). Message rõ ràng bỏ qua shortcut này.
3. `ensureWikiPromptRuleScaffolds()` tạo scaffold thiếu; kiểm tra lint rules trước run, trừ update có opt-in sửa rules.
4. Đọc brief/metadata, hash Wiki trước run; lưu `activeWikiRun` gồm command, cwd, snapshot và quyền sửa rules.
5. `createWikiTaskPrompt()` tạo yêu cầu, `pi.sendUserMessage()` đưa vào agent đang dùng provider/model/tools hiện tại. Status key `wiki` báo generating/updating khi có UI; không UI dùng console.
6. `agent_end` ghi nhận stopReason aborted/error của assistant cuối. `agent_settled` lấy và xóa active run, tạo scaffold mới cần thiết, hash lại, kiểm tra link/rules, rồi [finalize metadata](#snapshot-and-metadata).
7. `session_shutdown` xóa active run; nếu Wiki đổi thì ghi interrupted để lần sau retry. Status được dọn trong finally.

Cả hai prompt không chứa Git status, commit history, diff hoặc Git fields của metadata. Git vẫn dùng nội bộ cho no-op và ghi `gitHead`; agent có thể tự đọc Git evidence cần thiết. Nếu gửi message lỗi, active run và status bị xóa; lỗi command/finalization được notify/log, không rollback tài liệu.

## Source ownership

Các đường dẫn sau tương đối với `packages/pi-learn-extensions/extensions/`:

| Source | Ownership |
|---|---|
| `wiki/index.ts` | Entrypoint duy nhất, gọi registerWikiCommands |
| `wiki/wiki-commands.ts` | Lifecycle, tool guard, snapshot, no-op và metadata |
| `wiki/wiki-prompt.ts` | Task contract, opt-in detector, bootstrap AGENTS/CLAUDE |
| `wiki/wiki-rules.js` | Phân loại path, discovery, scaffold, rule lint |
| `wiki/wiki-links.js` | Internal Markdown links và heading anchors |

Thay command cần đồng bộ prompt, README, test và routes; thêm helper giữ trong thư mục Wiki để không thành public entrypoint độc lập.

## Conditional project reading

Bootstrap có hai điều kiện độc lập:

- Request về project: đọc `wiki/quickstart.md` một lần nếu context chưa có. Request không liên quan: không đọc.
- Ngay trước sửa component/domain: chỉ đọc root và domain `_rules.md` áp dụng. Read-only question không cần load rules.

Quickstart là task → system → page/heading route. Dùng grep giới hạn để tìm heading rồi ranged read; `#anchor` không tự giới hạn phạm vi filesystem read. Chỉ mở thêm khi gặp dependency, producer/consumer, shared contract hoặc evidence chưa đủ. Đây là hướng dẫn prompt, không phải sandbox cưỡng chế context.

## Explicit rule-update mode

`allowRuleUpdates` chỉ true khi command là update và `isExplicitRuleUpdateRequest(message)` khớp regex. Các cụm được nhận gồm `_rules.md`/`_rules`, Wiki rules, prompt rules, rule file(s), `quy tắc wiki`, `cập nhật rule`/`cập nhật các rule`.

```txt
/wiki-update Cập nhật wiki/**/_rules.md để phản ánh command surface mới
```

Detector là heuristic theo từ khóa, không phải phê duyệt ngữ nghĩa hay subsystem proposal/approval. Init không bao giờ bật quyền này, kể cả message nhắc rules.

`tool_call` chặn built-in write/edit tới rules khi không opt-in; metadata luôn được bảo vệ, brief được bảo vệ trong active run cùng cwd. Bash guard dò path và những mutation phổ biến (redirect, rm/mv/cp, tee, truncate, sed/perl in-place). Không coi regex guard là sandbox cho mọi tool/script; chi tiết [safety](../operations/testing-and-safety.md#security-and-privacy).

Khi opt-in, prompt yêu cầu sửa tối thiểu, giữ rule không liên quan và ID ổn định/duy nhất. Run có thể bắt đầu với rules invalid để sửa, nhưng finalization vẫn interrupted cho tới khi lint hợp lệ. Scaffold deterministic thiếu do extension tạo là ngoại lệ; agent của run thường không tự sửa rules.

## Agent bootstrap maintenance

Prompt giao agent đảm bảo mỗi top-level `AGENTS.md`/`CLAUDE.md` hiện có chứa đúng một section `## Project Wiki`; nếu cả hai vắng thì tạo AGENTS. Giữ nội dung khác, không sửa agent instruction file lồng nhau. Không có code rewrite bootstrap trực tiếp trong lifecycle.

Section chỉ chứa conditional quickstart loading, component-scoped rules và kiểm chứng source khi Wiki thiếu/cũ/mâu thuẫn. Test `wiki-prompt.test.mts` so sánh bootstrap sinh ra với hai file checked-in.

## Documentation workflow

`discovery → wiki/_plan.md tạm → research/write từng topic → coverage/navigation review`.

Prompt yêu cầu inventory manifests/entrypoints/contracts/tests/operations, trace control/data flow và ownership, không đặt quota trang, không suy đoán từ tên thư mục. Update giữ nội dung đúng không bị ảnh hưởng và đi theo consumer/shared contract của thay đổi. Xóa plan trước khi kết thúc, kiểm tra links/anchors; generated docs chỉ ở Wiki, ngoại lệ duy nhất là bootstrap top-level.

`wiki/INSTRUCTIONS.md` là brief do người dùng quản lý: scope, ngôn ngữ, ưu tiên, exclusions, audience. `readWikiBrief()` chấp nhận regular file không symlink, tối đa 64 KiB; thiếu file là bình thường, loại file/size sai làm command báo lỗi. Brief không vượt safety boundaries hoặc applicable rules.

## Snapshot and metadata

`createWikiSnapshot()` SHA-256 đường dẫn và byte content theo thứ tự ổn định, prefix `wiki-content-v2`. Bao gồm normal Markdown và `_rules.md`; bỏ symlink entries, brief, plan, hidden/temp paths, metadata, non-Markdown assets. Chỉ thay AGENTS/CLAUDE hay asset không làm snapshot đổi.

Metadata do extension ghi: `updatedAt` ISO, `command` init/update, `gitHead` nếu Git khả dụng, `model` dạng provider/id (fallback model.name hoặc `pi-current-model`), `status` complete/interrupted. JSON không parse được/thiếu fields cần thiết được coi như chưa có metadata; status không phải interrupted được đọc như complete.

| Điều kiện sau settled | Kết quả |
|---|---|
| Links/rules hợp lệ, không abort, Wiki đổi | Ghi complete |
| Links/rules hợp lệ, không abort, previous interrupted | Ghi complete dù không đổi |
| Links hoặc rules invalid | Ghi interrupted |
| Agent abort/error và Wiki đổi | Ghi interrupted |
| Abort/error không đổi, validation hợp lệ | Giữ metadata cũ |
| Thành công không đổi, previous không interrupted | Giữ metadata cũ |

Rule-only update cũng làm snapshot đổi. Finalization exception được báo riêng, có thể chưa ghi metadata; không có transaction/rollback. Shutdown chỉ ghi interrupted khi snapshot đổi. Sửa nguyên nhân rồi chạy lại `/wiki-update` với message cụ thể nếu cần.

## Link and rule validation

`validateWikiInternalLinks()` scan normal Wiki Markdown, bỏ reserved source paths, images và URL external. Link relative phải nằm trong Wiki; `/foo.md` được hiểu relative với Wiki root, không phải filesystem root. Target phải tồn tại, không symlink, realpath không thoát Wiki. Percent encoding sai, thiếu file/anchor hoặc traversal gây issue. Heading slug giữ chữ Unicode/dấu kết hợp, bỏ punctuation, lowercase, khoảng trắng thành hyphen; heading trùng thêm suffix `-1`, `-2`.

Parser dùng regex inline link/heading, không phải Markdown AST: không kiểm chứng toàn bộ reference-style links hoặc code-fence semantics. Không dùng link Markdown ra source ngoài Wiki; ghi source path bằng inline code.

`discoverWikiPromptRules()` yêu cầu root real directory và root rule; mỗi thư mục chứa trang Markdown cuối cùng cần `_rules.md`. Bỏ hidden/underscore directories, assets và _tmp. Không yêu cầu rule cho từng source file. File rule tối đa 64 KiB, UTF-8, không NUL. Heading được nhận dạng có dạng `## ID — tiêu đề` hoặc `## ID - tiêu đề`, ID uppercase chữ/số/hyphen, 3–64 ký tự. ID trùng trong file là error; trùng khác file là warning. Dòng `Origin proposal:` nếu có phải dùng ID `P-` và ít nhất bốn chữ số; không hàm ý runtime proposal còn tồn tại. Scaffold không cần có substantive rules; lint không xác minh đúng nghĩa của nội dung.

Rule symlink chỉ được chấp nhận nếu resolve tới file trong project; link target symlink thì bị từ chối. Xem [path safety](../operations/testing-and-safety.md#wiki-path-safety).

## No-op behavior

Update không message có thể skip khi rules/layout/links hợp lệ, previous metadata complete có Git head, worktree sạch ngoài metadata, và các commit từ head đã lưu chỉ đổi normal Wiki docs/metadata. Rule diff luôn buộc run; source/config diff cũng vậy.

Thiếu head/metadata, previous interrupted, worktree có thay đổi, invalid links/rules, hoặc diff paths không xác định an toàn thì không skip. Một commit mới không có changed paths cũng không skip. Git status failure đi qua command error handler, không tự tuyên bố no-op. Explicit message luôn chạy.

## Verification

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
```

Ba bộ test kiểm tra prompt/no-Git context/opt-in/bootstrap, rule classification/discovery/lint/scaffold và file/anchor/path links. Chưa có test trực tiếp cho `wiki-commands.ts` lifecycle, bash guard, snapshot/no-op hoặc settlement. Sau thay source chạy `/reload` và theo [manual scenarios](../operations/testing-and-safety.md#wiki-scenarios), trong repo thử nghiệm; không thử sửa protected files ở repo thật.
