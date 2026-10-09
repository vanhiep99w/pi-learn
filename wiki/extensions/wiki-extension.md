# Wiki capability

Phạm vi: command, prompt, đọc chọn lọc, agent-directed rule updates, validation và metadata của `packages/pi-learn-extensions/extensions/wiki/`. Extension chạy trong Pi hiện tại; không tạo provider/model hay bộ filesystem tools riêng.

## Commands and run lifecycle

Public commands chỉ có `/wiki [message]` (khởi tạo) và `/wiki-update [message]` (bảo trì có chọn lọc). Không có alias init/ask/status hay command hỏi Wiki riêng.

Luồng trong `wiki-commands.ts`:

1. `registerWikiCommands()` nhận args và `ctx.cwd`; từ chối khi `ctx.isIdle()` false.
2. Update không có message chạy kiểm tra [no-op](#no-op-behavior). Message rõ ràng bỏ qua shortcut này.
3. `ensureWikiPromptRuleScaffolds()` tạo scaffold thiếu; init kiểm tra lint rules trước run, update được bắt đầu để sửa lint invalid.
4. Đọc brief/metadata, hash Wiki trước run; lưu `activeWikiRun` gồm command, cwd và snapshot. Quyền sửa rules phụ thuộc command của active run, không phụ thuộc từ khóa trong message.
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
| `wiki/wiki-prompt.ts` | Task contract, phân loại intent/ownership bằng agent, bootstrap AGENTS/CLAUDE |
| `wiki/wiki-rules.js` | Phân loại path, discovery, scaffold, rule lint |
| `wiki/wiki-links.js` | Internal Markdown links và heading anchors |

Thay command cần đồng bộ prompt, README, test và routes; thêm helper giữ trong thư mục Wiki để không thành public entrypoint độc lập.

## Conditional project reading

Bootstrap có hai điều kiện độc lập:

- Request về project: đọc `wiki/quickstart.md` một lần nếu context chưa có. Request không liên quan: không đọc.
- Ngay trước sửa component/domain: chỉ đọc root và domain `_rules.md` áp dụng. Read-only question không cần load rules.

Quickstart là task → system → page/heading route. Dùng grep giới hạn để tìm heading rồi ranged read; `#anchor` không tự giới hạn phạm vi filesystem read. Chỉ mở thêm khi gặp dependency, producer/consumer, shared contract hoặc evidence chưa đủ. Đây là hướng dẫn prompt, không phải sandbox cưỡng chế context.

## Agent-directed rule updates

Mọi active `/wiki-update` run cùng cwd được phép sửa rule khi intent yêu cầu. Không còn detector regex hoặc flag quyền riêng: guard dùng `currentRun?.command !== "update"`. Agent tự phân loại message và chọn file; người dùng không cần nêu `_rules.md`, domain hay từ khóa đặc biệt.

```txt
/wiki-update Khi viết code tôi không muốn tự thêm unit test nữa
```

Prompt phân biệt facts về dự án → normal Wiki; chính sách làm việc lâu dài → `_rules.md` thuộc domain hẹp nhất; chỉ thị một lần → không lưu thành rule hay tài liệu. Root rule chỉ dành cho chính sách repository-wide. Agent đọc routes/rules/evidence để chọn owner, không hỏi người dùng tên file hoặc từ khóa cấp quyền. Chỉ hỏi lại nếu intent/thời hạn/ownership vẫn mơ hồ sau kiểm tra evidence. Không tự đổi chính sách cho yêu cầu docs-only hoặc update không có yêu cầu chính sách cụ thể; không suy diễn “không viết unit test mới” thành “không chạy test có sẵn”. Đây là phân loại bằng model theo prompt, không phải validator ngữ nghĩa deterministic.

`tool_call` vẫn chặn built-in write/edit tới rules ngoài active update, trong init hoặc khi cwd khác. Metadata luôn được bảo vệ, brief được bảo vệ trong active run cùng cwd. Bash guard dò path và mutation phổ biến (redirect, rm/mv/cp, tee, truncate, sed/perl in-place). Không coi regex guard là sandbox cho mọi tool/script; chi tiết [safety](../operations/testing-and-safety.md#security-and-privacy).

Prompt yêu cầu sửa tối thiểu, giữ rule không liên quan và ID ổn định/duy nhất. Update có thể bắt đầu với rules invalid để sửa, nhưng finalization vẫn interrupted cho tới khi lint hợp lệ. Scaffold deterministic thiếu do extension tạo là ngoại lệ. Khi settled/shutdown hoặc gửi message thất bại, active run bị xóa và rule lại được bảo vệ.

## Agent bootstrap maintenance

Prompt `/wiki` giao agent đảm bảo mỗi top-level `AGENTS.md`/`CLAUDE.md` hiện có chứa đúng một section `## Project Wiki`; nếu cả hai vắng thì tạo AGENTS. Giữ nội dung khác, không sửa agent instruction file lồng nhau. `/wiki-update` không nhận mẫu bootstrap và chỉ được sửa section Project Wiki của các file này khi người dùng yêu cầu rõ ràng. Không có code rewrite bootstrap trực tiếp trong lifecycle.

Section chứa conditional quickstart loading, component-scoped rules, kiểm chứng source khi Wiki thiếu/cũ/mâu thuẫn và hướng dẫn selective reading. Khối selective reading nằm trong mẫu Markdown bootstrap, không lặp thành một khối riêng ngoài mẫu. Test `wiki-prompt.test.mts` so sánh bootstrap sinh ra với hai file checked-in.

## Documentation workflow

`createWikiTaskPrompt()` trong `packages/pi-learn-extensions/extensions/wiki/wiki-prompt.ts` tách hai nhánh:

- `/wiki`: khảo sát manifests/entrypoints/contracts/tests/operations, trace control/data flow và ownership; `discovery → wiki/_plan.md tạm → research/write từng topic → coverage/navigation review`. Không đặt quota trang, không suy đoán từ tên thư mục; chèn mẫu bootstrap và contract tài liệu đầy đủ.
- `/wiki-update`: dùng `createUpdateInstructions()` riêng, không chèn inventory, mẫu bootstrap hoặc contract khởi tạo đầy đủ. Yêu cầu người dùng xác định scope; agent tạo impact map ngắn trong context, đọc quickstart khi cần định tuyến và chỉ đọc pages/source/tests/rules liên quan. Không bắt buộc plan file. Chỉ mở rộng sang producer/consumer/shared contract khi cần kiểm chứng; giữ nội dung đúng không bị ảnh hưởng, báo no-op khi không có impact.
- Update rule theo intent: agent tự chọn owner, đọc target rules và evidence component liên quan rồi sửa các rules trong scope; không viết lại tài liệu/bootstrap nếu yêu cầu không cần. Guard và validation toàn Wiki của extension vẫn giữ nguyên, prompt tập trung không có nghĩa bỏ kiểm tra finalization.

Generated docs chỉ ở Wiki, ngoại lệ là section bootstrap top-level theo quyền của từng mode. Nếu dùng plan tạm thì xóa trước khi kết thúc; kiểm tra links/anchors và validation liên quan.

`wiki/INSTRUCTIONS.md` là brief do người dùng quản lý: scope, ngôn ngữ, ưu tiên, exclusions, audience. Init đọc và chèn brief: `readWikiBrief()` chấp nhận regular file không symlink, tối đa 64 KiB; thiếu file là bình thường, loại file/size sai làm command init báo lỗi. Update không tự đọc/chèn toàn bộ brief qua `createRunContext()`; prompt hướng dẫn agent chỉ đọc khi cần ngôn ngữ/quy ước tài liệu và không dùng ưu tiên rộng để mở scope. Brief không vượt safety boundaries hoặc applicable rules và vẫn được bảo vệ trong active run.

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

Bốn bộ test kiểm tra prompt/no-Git context/intent/ownership/bootstrap, rule classification/discovery/lint/scaffold, file/anchor/path links và command guards/lifecycle. Command fixtures kiểm permission theo active command/cwd, init, update không từ khóa/không args, lint invalid, metadata/brief, settled/shutdown, busy và lỗi gửi message. Chưa test đầy đủ snapshot/no-op, interrupted metadata hoặc semantic classification bằng model thật. Sau thay source chạy `/reload` và theo [manual scenarios](../operations/testing-and-safety.md#wiki-scenarios), trong repo thử nghiệm; không thử sửa protected files ở repo thật.
