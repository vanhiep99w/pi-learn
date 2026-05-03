// Path resolvers cho harness-improver
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

// Workspace root = cwd hiện tại của Pi (extension chạy theo project)
export function workspaceRoot(): string {
  return process.cwd();
}

// .pi/ trong workspace
export function piDir(): string {
  return path.join(workspaceRoot(), ".pi");
}

// Thư mục log của extension. Cố tình tách riêng ra `.pi/logs/harness/`
// để không trộn với session JSONL của Pi (Pi tự lưu ở ~/.pi/agent/sessions/).
export function logDir(): string {
  return path.join(piDir(), "logs", "harness");
}

// File log theo ngày → dễ rotate, dễ grep
export function todayLogFile(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return path.join(logDir(), `actions-${yyyy}-${mm}-${dd}.jsonl`);
}

// Liệt kê tất cả log file (mới nhất trước)
export function listLogFiles(): string[] {
  const dir = logDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith("actions-") && f.endsWith(".jsonl"))
    .sort()
    .reverse()
    .map(f => path.join(dir, f));
}

// Pi sessions dir (default ~/.pi/agent/sessions/--<encoded-cwd>--/)
// Encode rule (theo PI_SESSIONS_GUIDE): thay '/' bằng '-' và bao bọc bằng '--'
export function piSessionsDir(): string | null {
  const home = os.homedir();
  const encoded = "--" + workspaceRoot().replace(/\//g, "-").replace(/^-+/, "") + "--";
  const dir = path.join(home, ".pi", "agent", "sessions", encoded);
  return fs.existsSync(dir) ? dir : null;
}

export function ensureLogDir() {
  const dir = logDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Reports / suggestions snapshots
export function reportsDir(): string {
  return path.join(piDir(), "logs", "harness", "reports");
}

export function ensureReportsDir() {
  const dir = reportsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
