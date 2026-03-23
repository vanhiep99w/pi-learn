/**
 * task-board.ts — Shared Task Board
 * File-based, atomic writes, dependency resolution
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type TaskStatus =
  | "pending"          // Chờ deps xong
  | "ready"            // Deps xong, chờ agent
  | "assigned"         // Đã assign, chưa bắt đầu
  | "in_progress"      // Đang chạy
  | "done"             // Hoàn thành ✓
  | "failed"           // Fail sau khi retry hết
  | "blocked"          // Dep bị fail, không thể chạy
  | "waiting_approval"; // Chờ user approve

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agent?: string;
  priority: "low" | "normal" | "high" | "urgent";
  depends_on: string[];
  created_at: number;
  started_at?: number;
  completed_at?: number;
  result?: string;           // Output cuối cùng của agent
  error?: string;
  retry_count: number;
  max_retries: number;
  require_approval?: boolean;
  approved?: boolean;
  metadata?: Record<string, unknown>;
}

interface BoardData {
  team: string;
  updated_at: number;
  tasks: Task[];
}

let taskCounter = 0;

function genId(): string {
  return `t-${Date.now().toString(36)}-${(++taskCounter).toString(36)}`;
}

// Counter để tạo unique tmp suffix trong cùng millisecond
let _writeSeq = 0;

// Atomic write (write-then-rename)
// Tmp filename PHẢI unique: PID + timestamp + seq tránh race condition
async function writeAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  // Đảm bảo directory tồn tại ngay trước khi write
  fs.mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${++_writeSeq}`;
  const tmp = `${filePath}.tmp.${suffix}`;
  const json = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, json, { encoding: "utf-8", mode: 0o600 });
  await fs.promises.rename(tmp, filePath);
}

export class TaskBoard {
  private teamDir: string;
  private filePath: string;
  private teamName: string;

  constructor(teamDir: string, teamName: string) {
    this.teamDir = teamDir;
    this.filePath = path.join(teamDir, "tasks.json");
    this.teamName = teamName;
    fs.mkdirSync(teamDir, { recursive: true });
  }

  // ── Read/Write ──────────────────────────────────────────────────
  private async read(): Promise<BoardData> {
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { team: this.teamName, updated_at: Date.now(), tasks: [] };
    }
  }

  private async write(data: BoardData): Promise<void> {
    data.updated_at = Date.now();
    await writeAtomic(this.filePath, data);
  }

  // ── CRUD ────────────────────────────────────────────────────────
  async createTask(input: {
    title: string;
    description: string;
    agent?: string;
    priority?: Task["priority"];
    depends_on?: string[];
    max_retries?: number;
    require_approval?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<Task> {
    const data = await this.read();
    const hasDeps = (input.depends_on?.length ?? 0) > 0;

    const task: Task = {
      id: genId(),
      title: input.title,
      description: input.description,
      status: hasDeps ? "pending" : "ready",
      agent: input.agent,
      priority: input.priority ?? "normal",
      depends_on: input.depends_on ?? [],
      created_at: Date.now(),
      retry_count: 0,
      max_retries: input.max_retries ?? 2,
      require_approval: input.require_approval,
      metadata: input.metadata,
    };

    data.tasks.push(task);
    await this.write(data);
    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    const data = await this.read();
    return data.tasks.find(t => t.id === id) ?? null;
  }

  async getAllTasks(): Promise<Task[]> {
    const data = await this.read();
    return data.tasks;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const data = await this.read();
    const idx = data.tasks.findIndex(t => t.id === id);
    if (idx < 0) return null;
    data.tasks[idx] = { ...data.tasks[idx], ...updates };
    await this.write(data);
    return data.tasks[idx];
  }

  async setStatus(id: string, status: TaskStatus, extra?: Partial<Task>): Promise<void> {
    const updates: Partial<Task> = { status, ...extra };
    if (status === "in_progress" && !extra?.started_at) updates.started_at = Date.now();
    if ((status === "done" || status === "failed") && !extra?.completed_at) {
      updates.completed_at = Date.now();
    }
    await this.updateTask(id, updates);
  }

  // ── Atomic claim (tránh race condition) ──────────────────────────
  async claimTask(taskId: string, agentName: string): Promise<boolean> {
    const data = await this.read();
    const task = data.tasks.find(t => t.id === taskId);

    if (!task || task.status !== "ready") return false;

    task.status = "assigned";
    task.agent = agentName;
    await this.write(data);
    return true;
  }

  // ── Queries ─────────────────────────────────────────────────────
  async getReadyTasks(): Promise<Task[]> {
    const data = await this.read();
    return data.tasks.filter(t => t.status === "ready");
  }

  async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
    const data = await this.read();
    return data.tasks.filter(t => t.status === status);
  }

  async getPendingApproval(): Promise<Task[]> {
    return this.getTasksByStatus("waiting_approval");
  }

  // ── Dependency Resolution ────────────────────────────────────────
  // Returns IDs of newly unlocked tasks
  async resolveDependencies(): Promise<string[]> {
    const data = await this.read();
    const unlocked: string[] = [];

    const doneIds = new Set(
      data.tasks.filter(t => t.status === "done").map(t => t.id)
    );
    const failedIds = new Set(
      data.tasks.filter(t => t.status === "failed" || t.status === "blocked").map(t => t.id)
    );

    for (const task of data.tasks) {
      if (task.status !== "pending") continue;

      const allDepsDone = task.depends_on.every(dep => doneIds.has(dep));
      const anyDepFailed = task.depends_on.some(dep => failedIds.has(dep));

      if (anyDepFailed) {
        task.status = "blocked";
        task.error = `Blocked: dependency failed`;
        unlocked.push(task.id); // mark dirty
      } else if (allDepsDone) {
        task.status = "ready";
        unlocked.push(task.id);
      }
    }

    if (unlocked.length > 0) await this.write(data);
    // Return only newly-ready tasks (not blocked)
    return unlocked.filter(id => {
      const t = data.tasks.find(t => t.id === id);
      return t?.status === "ready";
    });
  }

  // ── Summary for display ──────────────────────────────────────────
  async getSummary(): Promise<string> {
    const tasks = await this.getAllTasks();
    const counts = { done: 0, in_progress: 0, ready: 0, pending: 0, failed: 0, blocked: 0, other: 0 };

    for (const t of tasks) {
      if (t.status === "done") counts.done++;
      else if (t.status === "in_progress" || t.status === "assigned") counts.in_progress++;
      else if (t.status === "ready") counts.ready++;
      else if (t.status === "pending") counts.pending++;
      else if (t.status === "failed") counts.failed++;
      else if (t.status === "blocked") counts.blocked++;
      else counts.other++;
    }

    const parts: string[] = [];
    if (counts.done > 0) parts.push(`✓${counts.done}`);
    if (counts.in_progress > 0) parts.push(`⏳${counts.in_progress}`);
    if (counts.ready > 0) parts.push(`◎${counts.ready} ready`);
    if (counts.pending > 0) parts.push(`○${counts.pending} pending`);
    if (counts.failed > 0) parts.push(`✗${counts.failed}`);
    if (counts.blocked > 0) parts.push(`⊘${counts.blocked} blocked`);

    return parts.join("  ") || "no tasks";
  }

  async formatTable(): Promise<string> {
    const tasks = await this.getAllTasks();
    if (tasks.length === 0) return "(no tasks)";

    const icons: Record<TaskStatus, string> = {
      done: "✓", in_progress: "⏳", assigned: "⏳",
      ready: "◎", pending: "○", failed: "✗",
      blocked: "⊘", waiting_approval: "⏸",
    };

    return tasks.map(t => {
      const icon = icons[t.status] ?? "?";
      const agent = t.agent ? ` [${t.agent}]` : "";
      const elapsed = t.started_at
        ? ` ${Math.round((Date.now() - t.started_at) / 1000)}s`
        : "";
      return `${icon} ${t.id}  ${t.title}${agent}${elapsed}`;
    }).join("\n");
  }
}
