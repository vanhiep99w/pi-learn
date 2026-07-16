# Pi Harness Extension Migration Plan

> Bổ sung cho:
>
> - [`plan.md`](./plan.md)
> - [`roadmap.md`](./roadmap.md)
> - [`runtime-and-improvement.md`](./runtime-and-improvement.md)
> - [`harness-observability.md`](./harness-observability.md)
>
> Mục tiêu: chuyển trọng tâm UX của harness từ CLI sang **Pi extension**, vì harness này được viết riêng cho Pi và chủ yếu đọc session log của Pi.

---

## 1. Quyết định mới

Harness vẫn giữ core runtime testable, nhưng **Pi extension là primary user interface**. Standalone CLI đã được xoá; extension import runtime API trực tiếp.

```txt
Core runtime API:
  parse / tree / normalize / metrics / cache / logs
  testable outside Pi qua unit tests
  package entry: packages/harness-runtime/src/api.js

Pi extension:
  primary UX inside Pi
  slash commands
  current-session aware
  gọi runtime API, không spawn CLI child process

CLI:
  removed
```

User workflow chính:

```txt
Trong Pi:
  /harness-status
  /harness-scan-current
  /harness-inspect-current
  /harness-report
```

---

## 2. Vì sao ưu tiên extension

CLI hiện yêu cầu user biết path session JSONL:

```bash
harness inspect /path/to/session.jsonl
```

Điều này gây friction:

```txt
- user thường chỉ biết session id, không biết full path
- phải tự chạy `harness sessions` rồi copy `file:`
- phải dùng shell variable `$SESSION`
```

Trong Pi extension, runtime lấy được current session trực tiếp:

```ts
ctx.sessionManager.getSessionFile()
ctx.sessionManager.getLeafId()
ctx.cwd
```

Vậy command đúng hơn là:

```txt
/harness-scan-current
/harness-inspect-current
```

Không cần truyền session id/path.

---

## 3. Architecture mục tiêu

```txt
packages/harness-runtime/
  src/
    index.js
    scan-current-session.js
    config/
    project/
    session/
    normalize/
    metrics/
    safety/
    storage/
    logging/
  tests/

packages/pi-learn-extensions/extensions/harness/
  index.ts
  commands.ts
  adapter.ts
  ui.ts
  types.ts
```

Flow:

```txt
User trong Pi
  → /harness-scan-current
  → extension command handler
  → adapter lấy ctx.cwd + ctx.sessionManager.getSessionFile()
  → gọi harness runtime core
  → write ~/.pi/harness cache
  → ctx.ui.notify / ctx.ui.editor
```

Không spawn shell command nếu không cần.

Nên import/call core functions trực tiếp.

---

## 4. Core runtime vẫn giữ ở đâu?

Hiện core nằm ở:

```txt
packages/harness-runtime/
```

Extension public nằm ở:

```txt
packages/pi-learn-extensions/extensions/harness/
```

### 4.1 Step 1 — Giữ runtime hiện tại, extension import core

Extension import runtime qua relative path hoặc package path trong repo:

```ts
import { scanCurrentSession } from "../../../harness-runtime/src/index.js";
```

Ưu điểm:

```txt
- ít refactor
- CLI/tests giữ nguyên
- nhanh có extension để test trong Pi
```

Nhược điểm:

```txt
- distribution cần kiểm tra vì pi-learn-extensions package có thể không include packages/harness-runtime nếu install package con riêng
```

### 4.2 Step 2 — Sau khi ổn, quyết định packaging

Có 2 hướng:

```txt
A. Root pi-learn package include full repo, extension import packages/harness-runtime.
B. Move/copy harness core vào packages/pi-learn-extensions/harness-core để package con tự chứa đầy đủ.
```

Khuyến nghị:

```txt
Implement Step 1 trước.
Quyết định packaging sau khi extension MVP chạy được.
```

---

## 5. Runtime changes cần làm trước extension

### 5.1 Add library exports

Tạo:

```txt
packages/harness-runtime/src/index.js
```

Export:

```js
export { loadConfig } from "./config/load-config.js";
export { resolveProject } from "./project/resolve-project.js";
export { discoverSessions } from "./session/discover-sessions.js";
export { parseSessionFile } from "./session/parse-session.js";
export { buildSessionTree } from "./session/tree.js";
export { writeSessionCache } from "./storage/cache-writer.js";
export { createLogger } from "./logging/logger.js";
```

### 5.2 Add extension-friendly helpers

Tạo:

```txt
packages/harness-runtime/src/scan-current-session.js
```

API đề xuất:

```ts
type ScanCurrentSessionInput = {
  sessionFile: string;
  projectCwd: string;
  configOverrides?: {
    harnessHome?: string;
    sessionDir?: string;
    maxSessionsPerScan?: number;
  };
};

async function scanCurrentSession(input): Promise<{
  sessionId?: string;
  sessionFile: string;
  outDir: string;
  eventCount: number;
  warningsCount: number;
  metrics: SessionMetrics;
  paths: {
    manifest: string;
    events: string;
    metrics: string;
    warnings: string;
  };
}>;
```

### 5.3 Add inspect helper

Tạo helper:

```ts
async function inspectSessionFile({ sessionFile, projectCwd })
```

Return:

```ts
{
  sessionId,
  cwd,
  version,
  entryCount,
  activeLeafId,
  activePathCount,
  branchCount,
  warningsCount,
  activePathSummary
}
```

Extension dùng helper này cho:

```txt
/harness-inspect-current
```

---

## 6. Extension folder

Tạo:

```txt
packages/pi-learn-extensions/extensions/harness/
├── index.ts
├── commands.ts
├── adapter.ts
├── ui.ts
└── types.ts
```

### 6.1 `index.ts`

Chỉ register commands/events.

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerHarnessCommands } from "./commands.js";

export default function (pi: ExtensionAPI) {
  registerHarnessCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui?.setStatus?.("harness", "ready");
  });

  pi.on("session_shutdown", async () => {
    // cleanup future timers/watchers if any
  });
}
```

Lưu ý import namespace:

```txt
Public package hiện dùng @mariozechner/* peer deps.
Giữ style này trong packages/pi-learn-extensions.
```

### 6.2 `commands.ts`

Register slash commands:

```ts
export function registerHarnessCommands(pi: ExtensionAPI) {
  pi.registerCommand("harness-status", { ... });
  pi.registerCommand("harness-scan-current", { ... });
  pi.registerCommand("harness-inspect-current", { ... });
}
```

### 6.3 `adapter.ts`

Bridge Pi context → runtime core.

Functions:

```ts
getCurrentSessionFile(ctx)
resolveHarnessProject(ctx)
scanCurrentPiSession(ctx)
inspectCurrentPiSession(ctx)
listProjectSessions(ctx, last)
scanProjectSessions(ctx, last)
```

### 6.4 `ui.ts`

UI helpers:

```ts
notifyInfo(ctx, message)
notifyWarn(ctx, message)
notifyError(ctx, error)
showMarkdown(ctx, title, markdown)
formatScanSummary(result)
formatInspectSummary(result)
```

Always guard UI:

```ts
if (ctx.hasUI) ctx.ui?.notify(...)
```

---

## 7. Extension commands MVP

## 7.1 `/harness-status`

Mục tiêu: xác nhận extension chạy và biết current Pi context.

Shows:

```txt
Harness status
cwd: ...
projectKey: ...
sessionFile: ...
harnessHome: ~/.pi/harness
cache path: ...
```

Data source:

```ts
ctx.cwd
ctx.sessionManager.getSessionFile()
resolveProject(ctx.cwd)
loadConfig({ project: ctx.cwd })
```

No parsing session.

No heavy work.

---

## 7.2 `/harness-scan-current`

Mục tiêu: thay thế workflow CLI khó dùng.

Flow:

```txt
ctx.sessionManager.getSessionFile()
  → scanCurrentSession()
  → write manifest/events/metrics/warnings
  → notify summary
```

Output summary:

```txt
Harness scanned current session
session: 019e...
events: 536
warnings: 0
toolCalls: 137
toolErrors: 2
cache: ~/.pi/harness/projects/.../sessions/...
```

If no persisted session:

```txt
Current session is not persisted yet; nothing to scan.
```

---

## 7.3 `/harness-inspect-current`

Mục tiêu: inspect current session without path.

Shows:

```txt
session id
version
cwd
entries
active leaf
active path count
branch count
warnings count
```

No full content.

---

## 7.4 `/harness-cache-path`

Shows current cache path:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/
```

Useful for opening files manually.

---

## 8. Extension Phase 2 commands

### `/harness-sessions [last]`

List project sessions.

If `ctx.hasUI`:

```ts
ctx.ui.select("Pick session", sessions.map(...))
```

Options after select:

```txt
inspect selected
scan selected
show path
```

Text fallback:

```txt
latest 5 sessions with sessionId + timestamp
```

### `/harness-scan-project [last]`

Equivalent to:

```bash
harness scan --project . --last N
```

But triggered from Pi.

Default:

```txt
last = 5
```

### `/harness-warnings`

Read current session warnings cache and summarize:

```txt
missing_parent: 1
unknown_entry_type: 2
```

---

## 9. Extension Phase 3 report commands

Commands:

```txt
/harness-report
/harness-metrics
```

### `/harness-report`

Flow:

```txt
scan current session if stale/missing
  → generate Markdown report
  → write ~/.pi/harness/projects/<project-key>/reports/latest.md
  → show in editor or notify path
```

UI:

```ts
if (ctx.hasUI && ctx.ui?.editor) {
  await ctx.ui.editor(reportMarkdown);
}
```

Fallback:

```txt
notify path
```

### `/harness-metrics`

Show quick metrics:

```txt
turns
assistant messages
tool calls
tool errors
bash calls
models
tokens/cost
safety redactions
```

---

## 10. Extension Phase 4 notes/tags

Commands:

```txt
/harness-note <text>
/harness-tag success
/harness-tag failure <reason>
```

Use Pi session custom entries:

```ts
pi.appendEntry("harness-note", {
  text,
  createdAt: new Date().toISOString(),
});

pi.appendEntry("harness-tag", {
  status: "success" | "failure",
  reason,
  createdAt: new Date().toISOString(),
});
```

These are useful evidence for future outcome classification.

Do not inject into LLM context.

---

## 11. Extension Phase 5 proposal UI

Commands:

```txt
/harness-proposals  # picker + detail + approve/reject/approve&apply
```

No apply initially.

Flow:

```txt
read ~/.pi/harness/projects/<project-key>/proposals/draft/
  → list/select proposal
  → preview markdown
  → update metadata status approved/rejected
```

Apply remains later and high-risk.

---

## 12. Error handling policy

Every command handler must catch errors:

```ts
try {
  ...
} catch (error) {
  await notifyError(ctx, error);
}
```

Do not crash Pi.

Do not throw raw stack to UI by default.

In dev mode, details can be written to harness logs:

```txt
~/.pi/harness/logs/errors/YYYY-MM-DD.jsonl
```

---

## 13. Startup policy

Do not scan automatically on extension load.

Allowed on `session_start`:

```txt
- set status: harness ready
- maybe restore lightweight in-memory state
```

Not allowed at startup:

```txt
- parse full session
- scan project sessions
- generate report
- call LLM
```

Reason:

```txt
- avoid Pi startup slowdown
- avoid IO while session is initializing
- keep behavior user-triggered
```

---

## 14. Package/distribution concern

Root `package.json` currently exposes:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

Adding:

```txt
packages/pi-learn-extensions/extensions/harness/index.ts
```

should be discoverable through existing root manifest.

But package sub-manifest has:

```json
"files": [
  "extensions",
  "themes",
  "README.md"
]
```

If users install only `packages/pi-learn-extensions`, runtime outside that package may not be included.

Before release, choose:

```txt
A. require root pi-learn package install
B. include harness runtime in pi-learn-extensions files
C. move harness core into pi-learn-extensions/harness-core
```

For dev/MVP:

```txt
Use root repo package and relative import to packages/harness-runtime.
```

---

## 15. Testing plan

### 15.1 Runtime tests

```bash
npm --prefix packages/harness-runtime test
```

### 15.2 Extension direct test

```bash
pi -e ./packages/pi-learn-extensions/extensions/harness/index.ts
```

Inside Pi:

```txt
/harness-status
/harness-scan-current
/harness-inspect-current
/harness-cache-path
```

### 15.3 Reload test

After editing extension:

```txt
/reload
/harness-status
```

### 15.4 Package test

From root package:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@feat/commit-changes-prompt
```

or local package if available.

---

## 16. Implementation order

### Step 1 — Runtime library API

```txt
- add src/index.js exports
- add scanCurrentSession helper
- add inspectSessionFile helper
- tests
```

### Step 2 — Extension MVP files

```txt
packages/pi-learn-extensions/extensions/harness/
├── index.ts
├── commands.ts
├── adapter.ts
├── ui.ts
└── types.ts
```

Commands:

```txt
/harness-status
/harness-scan-current
/harness-inspect-current
/harness-cache-path
```

### Step 3 — Pi manual test

```bash
pi -e ./packages/pi-learn-extensions/extensions/harness/index.ts
```

### Step 4 — Project sessions commands

```txt
/harness-sessions
/harness-scan-project
```

### Step 5 — Report commands

```txt
/harness-report
/harness-metrics
/harness-warnings
```

### Step 6 — Notes/tags

```txt
/harness-note
/harness-tag
```

### Step 7 — Proposal UI

```txt
/harness-proposals  # picker + detail + approve/reject/approve&apply
```

---

## 17. Final target UX

User should not need shell for common harness tasks.

Inside Pi:

```txt
/harness-status
/harness-scan-current
/harness-report
/harness-proposals
```

CLI remains for:

```txt
- dev/debug
- tests
- automation
- recovery when extension fails
```

Final mental model:

```txt
Pi extension = primary harness UX
Runtime core = shared engine
CLI = dev/debug fallback
```
