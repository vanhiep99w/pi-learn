# Wiki capability

Phạm vi: command, prompt, đọc chọn lọc, agent-directed rule updates, validation và metadata của `packages/pi-learn-extensions/extensions/wiki/`. Extension chạy trong Pi hiện tại; không tạo provider/model riêng hoặc thay built-in filesystem tools. Read tools mới chỉ tra cứu/validate Wiki.

## Commands and run lifecycle

Public commands chỉ có `/wiki [message]` (khởi tạo) và `/wiki-update [message]` (bảo trì có chọn lọc). Không có alias init/ask/status hay command hỏi Wiki riêng.

Luồng trong `wiki-commands.ts`:

1. `registerWikiCommands()` nhận args và `ctx.cwd`; từ chối khi `ctx.isIdle()` false.
2. Update không có message chạy kiểm tra [no-op](#no-op-behavior). Message rõ ràng bỏ qua shortcut này.
3. `ensureWikiPromptRuleScaffolds()` tạo scaffold thiếu; init kiểm tra lint rules trước run, update được bắt đầu để sửa lint invalid.
4. Đọc brief/metadata, hash Wiki trước run; lưu `state.active` của extension instance gồm command, cwd và snapshot. Quyền sửa rules phụ thuộc command của active run, không phụ thuộc từ khóa trong message.
5. `createWikiTaskPrompt()` tạo yêu cầu, `pi.sendUserMessage()` đưa vào agent đang dùng provider/model/tools hiện tại. Status key `wiki` báo generating/updating khi có UI; không UI dùng console.
6. `agent_end` ghi nhận stopReason aborted/error của assistant cuối, không finalize ngay; lần retry thành công thay thế cờ lỗi trước đó. `agent_settled` lấy và xóa active run, tạo scaffold thiếu, hash lại, kiểm tra links/rules và schema/graph. Chỉ init hợp lệ, không abort/error mới ghi [bootstrap top-level bằng code](#agent-bootstrap-maintenance), trước khi [finalize metadata](#snapshot-and-metadata). Event aborted cũng chặn complete ngay cả khi không có assistant error message.
7. `session_shutdown` xóa active run; nếu Wiki đổi thì ghi interrupted để lần sau retry. Status được dọn trong finally.

Cả hai prompt không chứa Git status, commit history, diff hoặc Git fields của metadata. Git vẫn dùng nội bộ cho no-op và ghi `gitHead`; agent có thể tự đọc Git evidence cần thiết. Nếu gửi message lỗi, active run và status bị xóa; lỗi command/finalization được notify/log, không rollback tài liệu.

## Source ownership

Các đường dẫn sau tương đối với `packages/pi-learn-extensions/extensions/`:

| Source | Ownership |
|---|---|
| `wiki/index.ts` | Entrypoint duy nhất, đăng ký hai commands, sáu read tools và hai metadata tools |
| `wiki/wiki-commands.ts` | Lifecycle, tool guard, snapshot, no-op và metadata |
| `wiki/wiki-protection.ts` | Path/bash mutation checks của Wiki command owner, không OS sandbox hoặc tự forward vào external children |
| `wiki/wiki-prompt.ts` | Task contract, phân loại intent/ownership bằng agent, mẫu instructions bootstrap dùng lại bởi extension |
| `wiki/wiki-bootstrap.ts` | Ghi bootstrap top-level deterministic, giữ nội dung khác, kiểm tra target và thay file atomic từng file |
| `wiki/wiki-rules.js` | Phân loại path, discovery, scaffold, rule lint |
| `wiki/wiki-links.js` / `wiki/wiki-headings.js` | Internal Markdown links và shared ATX heading/anchor resolver, bỏ frontmatter/fenced code |
| `wiki/wiki-source-paths.js` | Literal source-scope validation/matching, không đọc source |
| `wiki/wiki-policy.js` | Exact service-name convention, safe path checks, existing rule paths và missing creation targets; không đọc policy text |
| `wiki/wiki-model.ts` | Read model: Wiki-only reads, guides/specs, lookup/search/slices và schema/graph diagnostics |
| `wiki/wiki-tools.ts` | Pi adapter cho sáu read tools, session/cwd cache, output budget và revision-checked pagination |
| `wiki/wiki-validation.ts` | Aggregate graph/links/rules theo scope; dùng validators hiện có qua safe read hooks |
| `wiki/wiki-spec-writer.ts` | Reuse upstream serialize/updateFrontmatterText, strict authoring, proposed graph checks, revision + file/repository queues |
| `wiki/wiki-mutation-tools.ts` | `wiki_spec_create`/`wiki_spec_update`, active run permits, session lifecycle và bounded receipts |
| `wiki/vendor/thinkrail-spec-graph/` | Core/tests ThinkRail được pin commit, Apache-2.0, provenance và patches; không có extension entrypoint riêng |

Tools đọc đã được wire vào entrypoint và task prompts. No-op/finalization kiểm thêm schema/graph qua read model; read tools không cấp quyền sửa rules hoặc đổi layout Wiki. Hai metadata tools và generator prompt cho Wiki mới đã có; không migration Wiki cũ hoặc tool xóa. Generator vẫn dùng agent hiện tại, chưa có semantic benchmark bằng model thật; đây chưa phải rollout workflow skills của ThinkRail. Subagents dùng external Herdsman qua [optional profile setup](../operations/herdsman-setup.md); runtime ThinkRail subagents đã bị xóa. Các guards ở đây bảo vệ session nạp Wiki extension, không tự forward vào Herdsman children.

Thay command cần đồng bộ prompt, README, test và routes; thêm helper giữ trong thư mục Wiki để không thành public entrypoint độc lập.

## Read-only Wiki tools

Tools hoạt động sau reload đúng source/package. Chỉ đọc `wiki/` của `ctx.cwd` hiện tại; không tự nạp toàn Wiki vào model context. Parser/graph/query/structural validation dùng core ThinkRail đã pin; adapter không đăng ký thêm `spec_*` aliases.

| Tool | Contract hiện tại |
|---|---|
| `wiki_search` | Substring/regex, metadata filters `type`/`tag`/`parent`/`dependsOn`; `scope` specs/guides/all, mặc định all để không ẩn legacy guides. Mặc định 50, tối đa 200 matches; `data.nextOffset` dùng để lấy match page tiếp theo với cùng filters. |
| `wiki_get` | Đúng một `id` hoặc Wiki-relative `path`, ví dụ `extensions/wiki-extension.md`. Mặc định trả metadata, revision, forward/reverse links và tối đa 100 headings (có cờ truncated), không body. `heading` là exact ATX title hoặc `#anchor`; trả verbatim section cùng subheadings tới trước heading cùng/cao cấp tiếp theo. Title trùng cần `occurrence` 1-based hoặc anchor; unknown/ambiguous selector là lỗi, không fallback body. BOM/CRLF/Unicode được giữ; section lớn dùng cùng output continuation. |
| `wiki_locate` | `sourcePath` project-relative literal → các specs có `source-paths` khớp. File khớp exact, directory scope có `/` cuối khớp prefix. Tối đa 200 owners, có total/truncated; xếp theo độ cụ thể nhưng không chọn winner. Không mở source; không match không chứng minh thiếu contract. |
| `wiki_rules` | `paths` + `task` → existing `rulePaths` để đọc và missing `suggestedRulePaths` để tạo khi người dùng yêu cầu lưu rule. Service-name convention không cần config; root/ancestor rules hiện có cộng dồn. Không policy text/override/ghi/scaffold. Dùng `read`, không dùng `wiki_get`, cho các file hiện có. |
| `wiki_graph` | subtree/ancestors/neighbors; neighbors đi cả forward/reverse, mặc định depends-on. Depth 0–4, mặc định 1; tối đa 100 nodes, 200 edges, 100 missing targets, có cờ truncated. Không trả prose/full frontmatter; graph khai báo không chứng minh đủ code consumers. |
| `wiki_validate` | Mặc định graph/schema; chọn rõ links/rules/all để kiểm thêm. Trả validity từng nhóm và diagnostics có scope/path/severity; lỗi nhóm này không che nhóm khác. Findings là report data (`valid: false`), không phải execution error; không tạo scaffold hoặc sửa file. |

Normal search/get/graph/locate không đọc brief, metadata, rules, hidden/scratch files, assets hay source ngoài Wiki. Resolver chỉ kiểm tra path types/tồn tại; không đọc source/policy bodies. ID trùng không được chọn ngầm file đầu làm canonical. Rules chỉ có read path riêng khi chọn lint rules/all; chỉ trả codes/diagnostics, không policy text. Link checks dùng cùng heading resolver: links tới assets hoặc reserved files không có anchor chỉ kiểm tồn tại, không đọc contents; protected heading targets không được đọc qua links. Safe readers từ chối symlink components, UTF-8/NUL lỗi và quá 1 MiB/document hoặc 64 KiB/rule. Các giới hạn này không phải OS sandbox.

Mỗi call trả compact JSON, tổng model-facing content và bounded details không quá 24 KiB. Thông thường dữ liệu ở `data`; khi lớn, kết quả có `format: "json-fragment"`, `fragment` và `output.continuation` chứa `outputOffset`/`expectedRevision`. Giữ nguyên query, nối các fragments theo thứ tự để khôi phục source JSON. Cursor output tính bằng UTF-16 character units, khác match `offset`; dùng đúng cursor được trả, không tự tính byte offsets. Kết quả thay đổi thì trả stale_output và yêu cầu bắt đầu lại. Revision kiểm result hiện tại, không phải transaction/snapshot lease; không lưu full output ra file tạm hoặc ẩn payload lớn trong details.

Cache chỉ thuộc extension instance, tối đa một canonical cwd đang dùng; reset ở session_start/shutdown, đổi cwd tạo model khác, không giữ session context cũ. Abort được kiểm trước/sau tác vụ đồng bộ, không hứa ngắt giữa một filesystem scan. Không dùng UI hoặc tạo agent turn mới; headless dùng cùng JSON/error contracts. Errors được chuẩn hóa, không echo raw YAML/OS errors.

Legacy guides vẫn search/get theo path được nhưng không tự thành graph nodes. Migration Wiki cũ đã được loại khỏi scope; graph của Wiki cũ có thể rỗng, không phải lỗi. Structural validity không đồng nghĩa semantic correctness, reviewed status hoặc policy/source đã nhất quán.

## Controlled spec metadata tools

Chỉ có `wiki_spec_create` và `wiki_spec_update`, không delete/rename/convert tool. Adapter dựa trên create/update patterns và core ThinkRail; không dùng raw upstream writes vốn thiếu Wiki guards, file queues và revision checks.

- **Quyền:** chỉ active `/wiki` hoặc `/wiki-update` của cùng extension instance và cùng cwd. `registerWikiCommands()` trả opaque run permit; tool kiểm trước thao tác và sau mọi queue wait. State thuộc instance, reset session_start/shutdown, settled hoặc failed send. Session khác dù cùng cwd không mượn quyền. Đây là giới hạn của hai custom tools, **không** áp điều kiện active run mới lên built-in edit/write normal Wiki pages.
- **Create:** `path` Wiki-relative, id/type/title bắt buộc, unique ID, không overwrite. Chỉ types durable; luôn status draft và heading scaffold từ upstream, chưa có prose đầy đủ. Parents/targets phải tồn tại; kết quả graph phải không duplicate/dangling/parent cycle. Có thể tạo node còn thiếu để sửa dangling edge, nhưng không được tự thêm spec cạnh legacy owner đã có.
- **Update:** lookup theo ID duy nhất và `expectedRevision` bằng `wiki_get.data.revision`. Chỉ set type/title/parent/status draft-stale-deprecated; remove parent/list fields, addList/removeList cho known lists. Không rename/remove ID, không bỏ required title/type, không tự chuyển active/done. Spec active hiện có giữ status nếu không yêu cầu đổi. Unknown/nested YAML fields, comments và body bytes được giữ qua `updateFrontmatterText` upstream; không generic reserialize whole file.
- **Authoring strict:** id/type/title trimmed, không control chars, tối đa 256 ký tự; known list fields phải arrays tối đa 200 strings. Đầu ra tối đa 1 MiB để read model nhìn thấy. Legacy unknown types/missing title/scalar lists vẫn read-tolerant, nhưng cần sửa thành schema authoring hợp lệ trước khi ghi metadata bằng tools.
- **Concurrency/safety:** queue tạm theo canonical project root chống duplicate-ID races giữa hai paths, sau đó dùng Pi `withFileMutationQueue` chung với built-in edit/write. Trong queue đọc lại file/path/root và kiểm document revision; update qua fd không truncating-open, kiểm inode/content, từ chối symlink và hardlink aliases. Permit hết hạn/cancel trước mutation không được ghi. Một filesystem write đã chạy không phải transaction/rollback; editor/process ngoài queue vẫn có race window. I/O failure có thể để partial file, phải inspect/validate trước retry.
- Không ghi source, `_rules.md`, brief, metadata, assets/scratch. Không cập nhật `.last-update.json` từ tool; finalization command sở hữu. Mutation receipts không chứa prose, lỗi được chuẩn hóa; không repeat mutation để lấy output. Không dùng dialogs/UI, chạy được headless.

Generator prompt tạo specs ngắn theo genuine module boundaries trong Wiki mới hoặc vùng thật sự chưa có tài liệu; giữ operations là guides, topology riêng, không quota số spec theo folder. Existing Wiki được bảo trì tại chỗ: không convert/split/move/delete hay tạo contract owner thứ hai. Đây là hướng dẫn agent, không deterministic semantic enforcement; kiểm source/tests/review vẫn cần. Rule routing dùng service-name convention như mục dưới; discovery/scaffolding giữ final-section layout. Không tự migrate policy files hiện có.

## Source scope và service rules

Source mapping là extension của adapter Wiki, không phải capability upstream có sẵn. Specs có thể khai báo `source-paths: [src/payments/, src/shared/refund.ts]`: tối đa 200 unique literal paths, 1024 ký tự/path, không absolute/traversal/backslash/globs. Create nhận `sourcePaths`; update dùng `addList`/`removeList` với key `source-paths`, hoặc `remove: ["source-paths"]`. Strict validation áp dụng cả đọc và ghi; field lỗi là schema error. Upstream parser/serializer vẫn giữ metadata, adapter chỉ bổ sung một YAML-AST list edit cho field riêng, giữ prose/comments/unknown fields. Không auto-discover owner, không theo rename và không tự thêm metadata cho guides cũ.

`wiki_rules` dùng convention chính xác: source thuộc top-level directory thật, hiện có `<service>/` → `wiki/modules/<service>/_rules.md`, cùng tên và phân biệt hoa/thường, **kể cả khi file hoặc thư mục Wiki này chưa có**. Ví dụ `order`, `order/`, `order/src/` hoặc `order/src/Foo.java` đều chỉ ra đích Order. Descendant mới bên trong service hiện có vẫn tra được. Không đoán alias hoặc owner từ tên thư mục lồng nhau; doc edits `wiki/modules/order/...` không được diễn giải thành source `order/...`. Source/rule paths không được qua symlink, traversal hoặc thư mục không an toàn.

Kết quả tách rõ:

- `rulePaths`: chỉ file rules **đã tồn tại**, gồm root và ancestor `wiki/modules/_rules.md` nếu có. Agent dùng `read` trước khi sửa; `wiki_get` vẫn loại reserved rules.
- `suggestedRulePaths`: đích rule **chưa tồn tại**, ví dụ `wiki/modules/order/_rules.md`; không đọc các đường dẫn này như file hiện có. Chỉ tạo khi người dùng yêu cầu lưu chính sách lâu dài.
- `matches`: service, target `rule` và cờ `exists`; nhận diện service kể cả khi target thiếu. `mode: "convention"` nếu nhận diện được service; nếu không thì `legacy`, dùng routes trong quickstart cho rules còn lại. `unmatchedPaths` giữ các source scopes chưa nhận diện.

Batches union/deduplicate targets. `task` vẫn bắt buộc là lowercase name hợp lệ để mô tả công việc, không có task selectors. Rule paths canonical `wiki/**/_rules.md`, tối đa 1024 ký tự/64 segments, không hidden/assets/build paths. Resolver không đọc prose, không ghi hoặc scaffold, không xác định xung đột ngữ nghĩa hay cấp quyền thay đổi chính sách.

Đã bỏ hoàn toàn `_domains.json`: không parser/schema/selectors, config routing, config-driven discovery/scaffold/lint hay snapshot riêng. File cũ nếu còn là tài nguyên không được dùng; không ảnh hưởng tra rules hoặc tính hợp lệ của Wiki. Không tự xóa file cũ ở repo người dùng. Discovery/lint/scaffolding áp dụng root + final documentation sections; scaffold trống không tự tạo chính sách.

## Conditional project reading

Bootstrap có hai điều kiện độc lập:

- Request về project: đọc `wiki/quickstart.md` một lần nếu context chưa có. Request không liên quan: không đọc.
- Ngay trước sửa component/domain: chỉ đọc root và domain `_rules.md` áp dụng. Read-only question không cần load rules.

Quickstart là task → system → page/heading route. Dùng grep giới hạn để tìm heading rồi ranged read; `#anchor` không tự giới hạn phạm vi filesystem read. Chỉ mở thêm khi gặp dependency, producer/consumer, shared contract hoặc evidence chưa đủ. Đây là hướng dẫn prompt, không phải sandbox cưỡng chế context.

## Agent-directed rule updates

Người dùng có thể yêu cầu lưu chính sách lâu dài qua chat thường hoặc `/wiki-update`, không cần tên file hay từ khóa đặc biệt. Built-in write/edit tới canonical Wiki rules được phép trong chat thường và active update cùng cwd; `/wiki` init và active run khác cwd vẫn chặn rules. Không có detector keyword cấp quyền: agent phân loại intent theo hướng dẫn trong tool description, bootstrap dùng chung và prompt update; đây không phải semantic authorization enforcement.

```txt
Thêm rule cho order service: không viết unit test mới
```

Prompt phân biệt facts → normal Wiki; chính sách lâu dài → `_rules.md` ở phạm vi hẹp nhất; chỉ thị một lần → không lưu. Root dành cho chính sách toàn repo. Agent dùng `wiki_rules`, đọc existing `rulePaths`, rồi tạo/sửa đích convention khi user yêu cầu. Với service `order/`, lưu tại `wiki/modules/order/_rules.md`, không tạo `order/AGENTS.md` để thay Wiki policy; không cấm những thay đổi AGENTS hợp lệ được giao riêng. Chỉ hỏi lại khi intent/thời hạn/scope mơ hồ. Không tự đổi chính sách cho code/docs-only, không suy diễn “không viết test mới” thành “không chạy test cũ”.

`tool_call` giữ metadata extension-owned, brief được bảo vệ trong active run cùng cwd, và từ chối rule writes qua symlink, traversal, ngoài cwd hoặc noncanonical path. Bash guard dò path/mutation phổ biến (redirect, rm/mv/cp, tee, truncate, sed/perl in-place); không coi regex là sandbox cho mọi tool/script. Ordinary-chat permission không mở quyền secrets hoặc metadata tools; xem [safety](../operations/testing-and-safety.md#security-and-privacy).

Prompt yêu cầu sửa tối thiểu, giữ unrelated rules và IDs ổn định/duy nhất. Update có thể repair rule lint invalid, nhưng finalization vẫn interrupted cho tới khi valid. Scaffold deterministic trống do extension tạo là ngoại lệ. Settled/shutdown/delivery failure xóa active run, trở lại quyền chat thường; không tái áp giới hạn active-update-only. Chat thường không chạy Wiki finalization/ghi metadata tự động; kiểm tra nội dung và chạy validation phù hợp, hoặc `/wiki-update` để kiểm/finalize toàn Wiki.

## Agent bootstrap maintenance

Extension ghi bootstrap deterministic trong `agent_settled`, chỉ sau `/wiki` init có links/rules/schema/graph hợp lệ và không abort/error. Không gửi mẫu `## Project Wiki` trong prompt gen Wiki hoặc giao model chép lại. Mỗi top-level `AGENTS.md`/`CLAUDE.md` hiện có được chuẩn hóa về đúng một section; nếu cả hai vắng thì tạo `AGENTS.md`. Giữ nội dung khác, không sửa file lồng nhau, từ chối target symlink hoặc không phải regular file. Chạy lại không ghi khi nội dung đã đúng. Lỗi bootstrap chặn thông báo hoàn tất và ghi metadata complete; không có transaction toàn run.

Không tự bootstrap khi mở phiên, shutdown hoặc chạy `/wiki-update`. Update chỉ được giao sửa section Project Wiki của các file này khi người dùng yêu cầu rõ ràng. Ghi file không tự nạp lại instructions vào context phiên đang chạy.

Section lấy từ `createWikiAgentInstructions()`: conditional quickstart loading, component-scoped rules, kiểm chứng source khi Wiki thiếu/cũ/mâu thuẫn, selective reading và hướng dẫn lasting policy trong chat thường. Repo cũ không tự được rewrite khi reload; tool description mới vẫn cung cấp routing, còn bootstrap muốn đồng bộ cần init hợp lệ hoặc explicit refresh được user yêu cầu. Khối goal-driven execution yêu cầu xác định tiêu chí thành công trước khi sửa project, gắn bước làm với cách kiểm chứng, tái hiện bug/so sánh trước-sau khi refactor và báo rõ phần đã/chưa xác minh. Chọn test, build, đo lường hoặc kiểm tra thủ công phù hợp; không bắt buộc thêm test trái quy tắc project hay yêu cầu người dùng. Focused tests kiểm mẫu mới, giữ nguyên baseline hướng dẫn checked-in, preservation/idempotence của writer và điều kiện lifecycle trước khi ghi.

## Documentation workflow

`createWikiTaskPrompt()` trong `packages/pi-learn-extensions/extensions/wiki/wiki-prompt.ts` tách hai nhánh:

- `/wiki`: task ngắn gồm Research → Write → Safety → Finish. Khảo sát theo thứ tự agent files → docs → manifests/layout → code/tests/operations, tái sử dụng guidance đã có trong context. Trước khi viết dựng working model ngắn trong context (purpose, domain, stack, modules/responsibilities/dependencies, invariants, decisions/missing why), không tạo file model; trace representative flows để kiểm chứng. Inventory chỉ phục vụ research, không là output. Plan mặc định trong context; chỉ tạo `wiki/_plan.md` khi cần và file chưa có, chỉ dọn plan do run tạo. Không nhúng manuals lookup/metadata tools, chi tiết queue/revision/active run hoặc lời kể lifecycle runtime.
- Init ghi giới hạn đã xác nhận vào spec sở hữu; TODO hoặc thiếu tests riêng lẻ không đủ chứng minh giới hạn. Chỉ hỏi intent/rationale/limitations khi thiếu thông tin quan trọng mà files không trả lời được. Handoff tách confirmed findings, inferences và phần cần người dùng review, bên cạnh files/checks/corrections/gaps.
- `/wiki-update`: dùng `createUpdateInstructions()` riêng, không chèn inventory, mẫu bootstrap hoặc contract khởi tạo đầy đủ. Yêu cầu người dùng xác định scope; agent tạo impact map ngắn trong context, đọc quickstart khi cần định tuyến và chỉ đọc pages/source/tests/rules liên quan. Không bắt buộc plan file. Chỉ mở rộng sang producer/consumer/shared contract khi cần kiểm chứng; giữ nội dung đúng không bị ảnh hưởng, báo no-op khi không có impact.
- Lookup guidance chỉ ở update: `wiki_search` scopes phù hợp, get metadata/explicit section, locate declared source owners, resolver trả rule paths trước edits và graph small depth/reverse consumers và kiểm source/tests; tools unavailable thì fallback targeted grep/read. Init chỉ yêu cầu dùng spec tools cho metadata và edit cho prose; mechanics nằm trong tool descriptions/guards. Cả hai giữ safety, draft/review, canonical ownership và không migration.
- Update task hoàn tất: giữ verified behavior, confirmed rationale và constraints còn hiệu lực tại canonical owner; không chép checklist/history, tự xóa user plans hoặc promote draft. Sửa spec đã có thì giữ ID, kiểm reverse consumers, báo conflict source/spec thay vì tự quyết.
- Update rule theo intent: agent tự chọn owner, đọc target rules và evidence component liên quan rồi sửa các rules trong scope; không viết lại tài liệu/bootstrap nếu yêu cầu không cần. Guard và validation toàn Wiki của extension vẫn giữ nguyên, prompt tập trung không có nghĩa bỏ kiểm tra finalization.

Prompt init giới hạn generated docs dưới `wiki/`; phần bootstrap top-level cố định do extension ghi sau khi run hợp lệ, không còn khối Markdown hay ngoại lệ cho model sửa bootstrap trong prompt init. Update chỉ cho model sửa Project Wiki top-level khi người dùng yêu cầu rõ ràng. Safety và validation vẫn là yêu cầu bắt buộc, không bị xóa khi rút prompt.

`wiki/INSTRUCTIONS.md` là brief do người dùng quản lý: scope, ngôn ngữ, ưu tiên, exclusions, audience. Init đọc và chèn brief: `readWikiBrief()` chấp nhận regular file không symlink, tối đa 64 KiB; thiếu file là bình thường, loại file/size sai làm command init báo lỗi. Brief vắng/rỗng được bỏ khỏi prompt hoàn toàn, không chèn thông báo “none found” hoặc separator rỗng. Update không tự đọc/chèn toàn bộ brief qua `createRunContext()`; prompt hướng dẫn agent chỉ đọc khi cần ngôn ngữ/quy ước tài liệu và không dùng ưu tiên rộng để mở scope. Brief không vượt safety boundaries hoặc applicable rules và vẫn được bảo vệ trong active run.

## Snapshot and metadata

`createWikiSnapshot()` SHA-256 đường dẫn và byte content theo thứ tự ổn định, prefix `wiki-content-v2`. Bao gồm normal Markdown và `_rules.md`; bỏ symlink entries, brief, plan, hidden/temp paths, metadata, non-Markdown assets. Chỉ thay AGENTS/CLAUDE hay asset không làm snapshot đổi.

Metadata do extension ghi: `updatedAt` ISO, `command` init/update, `gitHead` nếu Git khả dụng, `model` dạng provider/id (fallback model.name hoặc `pi-current-model`), `status` complete/interrupted. JSON không parse được/thiếu fields cần thiết được coi như chưa có metadata; status không phải interrupted được đọc như complete.

| Điều kiện sau settled | Kết quả |
|---|---|
| Links/rules/schema/graph hợp lệ, không abort, Wiki đổi | Ghi complete |
| Tất cả hợp lệ, không abort, previous interrupted | Ghi complete dù không đổi |
| Links, rules hoặc schema/graph invalid | Ghi interrupted dù không đổi |
| Agent abort/error và Wiki đổi | Ghi interrupted |
| Abort/error không đổi, validation hợp lệ | Giữ metadata cũ |
| Thành công không đổi, previous không interrupted | Giữ metadata cũ |

Schema/graph warnings được thông báo nhưng không chặn complete; errors (YAML/identity/list lỗi, ID trùng, dangling edges, parent cycles, I/O/encoding lỗi) chặn complete. Legacy guides không metadata không phải errors. `complete` chỉ phản ánh structural finalization, không user approval hoặc semantic correctness; không sửa review status/frontmatter. Metadata schema và snapshot prefix không đổi; mỗi lần no-op/finalize đều validate lại, không tin metadata complete cũ thay cho graph checks.

Rule-only update cũng làm snapshot đổi. Finalization exception được báo riêng, có thể chưa ghi metadata; không có transaction/rollback. Shutdown chỉ ghi interrupted khi snapshot đổi. Sửa nguyên nhân rồi chạy lại `/wiki-update` với message cụ thể nếu cần.

## Link and rule validation

Lifecycle bổ sung `WikiReadModel.validate()` cho schema/graph, reuse legacy link/rule validators; scaffold/discovery dùng final documentation sections, không có config mode. Graph check tạo model tạm riêng mỗi lần; không tái sử dụng stale cache từ tools/session. Lỗi graph được báo bằng summary path/code có giới hạn; dùng `wiki_validate` scope graph để xem details. Lỗi khởi tạo model cũng là validation error, không được biến thành pass/no-op.

`validateWikiInternalLinks()` scan normal Wiki Markdown, bỏ reserved source paths, images và URL external. Link relative phải nằm trong Wiki; `/foo.md` được hiểu relative với Wiki root, không phải filesystem root. Target phải tồn tại, không symlink, realpath không thoát Wiki. Percent encoding sai, thiếu file/anchor hoặc traversal gây issue. Heading slug giữ chữ Unicode/dấu kết hợp, bỏ punctuation, lowercase, khoảng trắng thành hyphen; heading trùng thêm suffix `-1`, `-2`.

Parser không phải Markdown AST: inline link regex chưa hỗ trợ đầy đủ reference links/code-fence semantics. Shared heading resolver nhận ATX headings, bỏ frontmatter/fenced code và tránh anchor collisions; chưa hỗ trợ Setext/HTML headings. Không dùng link Markdown ra source ngoài Wiki; ghi source path bằng inline code.

`discoverWikiPromptRules()` yêu cầu root real directory và root rule; cần `_rules.md` ở mỗi thư mục chứa trang Markdown cuối cùng. Bỏ hidden/underscore directories, assets và _tmp. Không yêu cầu rule cho từng source file. File rule tối đa 64 KiB, UTF-8, không NUL. Heading được nhận dạng có dạng `## ID — tiêu đề` hoặc `## ID - tiêu đề`, ID uppercase chữ/số/hyphen, 3–64 ký tự. ID trùng trong file là error; trùng khác file là warning. Dòng `Origin proposal:` nếu có phải dùng ID `P-` và ít nhất bốn chữ số; không hàm ý runtime proposal còn tồn tại. Scaffold không cần có substantive rules; lint không xác minh đúng nghĩa của nội dung.

Command rule lint chỉ chấp nhận symlink nếu resolve tới file trong project; resolver, mutation guard và public safe rule lint từ chối symlinks. Link target symlink luôn bị từ chối. Xem [path safety](../operations/testing-and-safety.md#wiki-path-safety).

## No-op behavior

Update không message có thể skip khi rules/layout/links và schema/graph hợp lệ, previous metadata complete có Git head, worktree sạch ngoài metadata, và các commit từ head đã lưu chỉ đổi normal Wiki docs/metadata. Rule diff luôn buộc run; source/config diff cũng vậy.

Thiếu head/metadata, previous interrupted, worktree có thay đổi, invalid links/rules/schema/graph, hoặc diff paths không xác định an toàn thì không skip. Một commit mới không có changed paths cũng không skip. Git status failure đi qua command error handler, không tự tuyên bố no-op. Explicit message luôn chạy. Git status giữ nguyên leading XY columns để loại riêng thay đổi metadata, kể cả untracked/modified; không trim đầu dòng rồi suy ra worktree có source changes.

## Verification

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
```

Tám bộ Node tests kiểm tra prompt/no-Git context/intent/ownership/bootstrap, rule classification/discovery/lint/scaffold, file/anchor/path links, command guards/lifecycle và read model mới. Model/tool fixtures kiểm exclusions, schema diagnostics, duplicate ID, graph relations, cache freshness, read limits, path/symlink safety, root isolation, scoped validation, output pagination, ordinary-chat rule writes, init protection và quyền metadata tools không đổi. `test:wiki:upstream` chạy riêng tests ThinkRail nguyên bản bằng Bun; `test:wiki:host` dùng Pi loader/TypeBox thật và fixture cwd/agentDir, không gọi provider hoặc đọc user auth/settings. Smoke này kiểm headless và factory replacement, không thay kiểm `/reload` trên TUI thật. Command fixtures kiểm thêm graph/schema finalization, clean-Git no-op/metadata-only status, committed Wiki defects, warnings, unchanged invalid Wiki, interrupted repair, abort/error/retry/shutdown và metadata preservation. Host smoke cũng gọi command handler với message transport giả lập để kiểm interrupted → repair → complete. Chưa test toàn bộ Git/error/concurrency/snapshot cases hoặc semantic classification bằng model thật. Sau thay source chạy `/reload` và theo [manual scenarios](../operations/testing-and-safety.md#wiki-scenarios), trong repo thử nghiệm; không thử sửa protected files ở repo thật.
