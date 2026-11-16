# Herdsman profile setup

Pi Learn giữ profile user-selected và explicit setup script dưới `packages/pi-learn-extensions/profiles/herdsman/` và `packages/pi-learn-extensions/scripts/setup-herdsman.mjs`. Canonical setup instructions: `packages/pi-learn-extensions/profiles/herdsman/README.md`; source values: `profile.json`, `flexible-lead.md` cùng thư mục. Khi thay config portable, sửa templates trước, không commit generated config cá nhân.

## Scope

`npm run setup:herdsman` (root hoặc subpackage) áp dụng global overrides cho sáu bundled Herdsman agents, thêm tool-display/web-access/Aurora UI và web tool allowlist, giữ `noExtensions`, không bật Wiki/ChatGPT usage/theme, đặt `maxAgentDepth: 1`, merge prompt Flexible Lead theo managed block. Không tự install, không sửa Pi settings/auth, không auto-run khi Pi load package. Runtime ThinkRail subagents, vendor/tests riêng và contract cũ đã bị xóa; không còn tools Agent/result hoặc `/subagents` của Pi Learn để bật lại. Đây là config companion cho external Herdsman, không phải backend Herdr mới của ThinkRail. Wiki Spec Graph core vẫn giữ nguyên.

## Execution and boundaries

Cài Pi/Herdr TUI và ba packages `pi-herdsman`, `pi-tool-display`, `pi-web-access` trước. Từ đúng checkout, chạy `npm run setup:herdsman -- --dry-run`, kiểm tra target paths rồi chạy `npm run setup:herdsman`. Agent dir resolve qua CLI/env/default; ba packages ngoài được lookup mặc định dưới agent dir, hỗ trợ `--packages-dir`. Aurora (`./extensions/aurora-ui.ts` trong profile) resolve từ root subpackage chứa setup script/profile, đúng checkout hoặc Git package đang chạy; không lookup Pi Learn dưới `--packages-dir` hay dựa vào cwd. Sáu overlays dùng additive `+absolute-path` cho Aurora; thiếu resource hoặc explicit removal xung đột thì báo lỗi trước khi ghi. Không copy paths home của máy cũ. Restart/reload Pi cha trong Herdr, chọn `/lead flexible`, kiểm tra effective Definitions và child mới.

Script giữ unrelated config/prompt/model và báo lỗi khi gặp legacy fields, explicit tool-deny conflicts hoặc unsafe targets. Có all-target preflight và per-file rename, không cross-file transaction, filesystem sandbox hay đảm bảo chống mọi race/power-loss. Project/private overlays có thể override global definitions. Prompt reference-first là guidance, không hard-disable native evidence handoff. Web access có side effects network/cache; không chuyển credential hoặc kết quả benchmark/token guarantees.

## Verification

`npm --prefix packages/pi-learn-extensions run test:setup` dùng temporary agent/package fixtures, không đọc user auth/settings/session logs hoặc gọi provider. Kiểm portable paths (kể cả Aurora trong checkout/Git package được di chuyển, tách khỏi cwd/npm lookup), nâng cấp sáu overlays chỉ thêm Aurora, preservation/idempotency, dry-run, YAML/config errors, unsafe targets, concurrency mismatch và package inclusion. Đây không phải test child TUI thật hoặc web provider/network. Khi đổi entrypoint/schema, kiểm lại installed package contracts và manual Herdr smoke có chủ đích.
