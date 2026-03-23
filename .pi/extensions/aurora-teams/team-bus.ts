/**
 * team-bus.ts — File-based messaging giữa agents
 * Mỗi agent có inbox riêng: .pi/teams/{team}/inbox/{agent}.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type MessageType =
  | "info"       // Thông báo thông thường
  | "request"    // Yêu cầu thông tin
  | "response"   // Trả lời request
  | "handoff"    // Chuyển giao task
  | "status"     // Update trạng thái
  | "error"      // Báo lỗi
  | "question";  // Hỏi user

export interface TeamMessage {
  id: string;
  from: string;
  to: string;    // agent name | "orchestrator" | "broadcast"
  type: MessageType;
  content: string;
  task_id?: string;
  timestamp: number;
  read: boolean;
}

// Counter để đảm bảo tmp filename unique ngay cả khi gọi cùng millisecond
let _busWriteSeq = 0;

// Atomic write helper
async function writeAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${++_busWriteSeq}`;
  const tmp = `${filePath}.tmp.${suffix}`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.promises.rename(tmp, filePath);
}

export class TeamBus {
  private inboxDir: string;
  private watchers: Map<string, NodeJS.Timeout> = new Map();

  constructor(teamDir: string) {
    this.inboxDir = path.join(teamDir, "inbox");
    fs.mkdirSync(this.inboxDir, { recursive: true });
  }

  private inboxPath(agentName: string): string {
    return path.join(this.inboxDir, `${agentName}.json`);
  }

  private async readInboxRaw(agentName: string): Promise<TeamMessage[]> {
    try {
      const raw = await fs.promises.readFile(this.inboxPath(agentName), "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // ── Gửi message ────────────────────────────────────────────────
  async send(message: Omit<TeamMessage, "id" | "timestamp" | "read">): Promise<string> {
    const id = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    const full: TeamMessage = { ...message, id, timestamp: Date.now(), read: false };

    const targets = message.to === "broadcast" ? await this.getAllAgents() : [message.to];

    for (const target of targets) {
      const msgs = await this.readInboxRaw(target);
      msgs.push(full);
      // Giữ tối đa 100 messages per inbox
      const trimmed = msgs.slice(-100);
      await writeAtomic(this.inboxPath(target), trimmed);
    }

    return id;
  }

  // ── Đọc inbox ──────────────────────────────────────────────────
  async readInbox(agentName: string, unreadOnly = true): Promise<TeamMessage[]> {
    const msgs = await this.readInboxRaw(agentName);
    return unreadOnly ? msgs.filter(m => !m.read) : msgs;
  }

  // ── Đánh dấu đã đọc ────────────────────────────────────────────
  async markRead(agentName: string, messageIds?: string[]): Promise<void> {
    const msgs = await this.readInboxRaw(agentName);
    for (const msg of msgs) {
      if (!messageIds || messageIds.includes(msg.id)) {
        msg.read = true;
      }
    }
    await writeAtomic(this.inboxPath(agentName), msgs);
  }

  // ── Broadcast tới tất cả agents ────────────────────────────────
  async broadcast(from: string, content: string, type: MessageType = "info"): Promise<void> {
    await this.send({ from, to: "broadcast", type, content });
  }

  // ── Watch inbox (polling) ───────────────────────────────────────
  watch(
    agentName: string,
    callback: (msgs: TeamMessage[]) => void,
    intervalMs = 1000
  ): () => void {
    const key = agentName;
    if (this.watchers.has(key)) clearInterval(this.watchers.get(key)!);

    const timer = setInterval(async () => {
      const unread = await this.readInbox(agentName, true);
      if (unread.length > 0) {
        await this.markRead(agentName, unread.map(m => m.id));
        callback(unread);
      }
    }, intervalMs);

    this.watchers.set(key, timer);
    return () => {
      clearInterval(timer);
      this.watchers.delete(key);
    };
  }

  // ── List all agents (by inbox files) ───────────────────────────
  private async getAllAgents(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.inboxDir);
      return entries
        .filter(e => e.endsWith(".json"))
        .map(e => e.slice(0, -5));
    } catch {
      return [];
    }
  }

  // ── Format messages cho agent system prompt ───────────────────
  formatForPrompt(messages: TeamMessage[]): string {
    if (messages.length === 0) return "(không có tin nhắn mới)";
    return messages.map(m => {
      const time = new Date(m.timestamp).toLocaleTimeString("vi-VN");
      return `[${time}] Từ ${m.from} (${m.type}): ${m.content}`;
    }).join("\n");
  }

  stopAll(): void {
    for (const timer of this.watchers.values()) clearInterval(timer);
    this.watchers.clear();
  }
}
