/** Event-level projection: no turn grouping, no filesystem access, no model calls. */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { sampleHistory } from "./tree-sample.ts";
import { toolTarget } from "./tree-tools.ts";

export type EventKind = "user" | "assistant" | "thinking" | "thinking_group" | "tool_call" | "tool_result" | "system" | "metadata";
export type EventNode = { id: string; parentId: string | null; entryId: string; kind: EventKind; title: string; body?: string; error?: boolean; members?: EventNode[] };
export type EventSnapshot = { nodes: EventNode[]; currentId: string | null };
export type EventRow = { node: EventNode; prefix: string; ancestor: boolean; hasChildren: boolean };
export const eventId = (entryId: string, part = 0) => JSON.stringify([entryId, part]);
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const preview = (text: string) => Array.from(normalize(text)).slice(0, 180).join("");
function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(block => block?.type === "text" && typeof block.text === "string" ? [block.text]
    : block?.type === "image" ? ["[Ảnh đính kèm]"] : []).join("\n");
}

/**
 * Each raw entry remains a separate position. Assistant content blocks are split
 * in their recorded order; raw child entries attach to the final part of their
 * actual parent. A tool call and its result are different events, both title-only.
 */
export function sessionEvents(entries: readonly SessionEntry[], leafId: string | null): EventSnapshot {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const parts = new Map<string, EventNode[]>();
  const originatingCall = (entry: SessionEntry, callId: string) => {
    const seen = new Set<string>();
    let cursor = entry.parentId ? byId.get(entry.parentId) : undefined;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.type === "message" && cursor.message.role === "assistant") {
        const call = cursor.message.content.find(block => block.type === "toolCall" && block.id === callId);
        if (call?.type === "toolCall") return call;
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return undefined;
  };
  for (const entry of entries) {
    const nodes: EventNode[] = [];
    const add = (kind: EventKind, title: string, body?: string, error?: boolean) => nodes.push({
      id: eventId(entry.id, nodes.length), parentId: null, entryId: entry.id, kind, title, ...(body ? { body } : {}), ...(error ? { error } : {}),
    });
    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const body = textContent(msg.content) || "[Tin nhắn không có văn bản]";
        add("user", "user: " + preview(body), body);
      } else if (msg.role === "assistant") {
        for (const block of msg.content) {
          if (block.type === "thinking") {
            // Only text actually stored by the provider; never use signatures or reconstruct hidden reasoning.
            const body = block.redacted ? "[Thinking đã được ẩn bởi provider]" : typeof block.thinking === "string" ? block.thinking : "";
            add("thinking", "thinking: " + (preview(body) || "(không có nội dung được lưu)"), body, msg.stopReason === "error");
          } else if (block.type === "text") {
            add("assistant", "assistant: " + (preview(block.text) || "(no content)"), block.text, msg.stopReason === "error");
          } else if (block.type === "toolCall") {
            add("tool_call", `tool call: ${block.name} ${toolTarget(block)}`.trim());
          }
        }
        if (!nodes.length || (!nodes.some(node => node.kind === "assistant") && (msg.stopReason === "aborted" || msg.stopReason === "error"))) {
          add("assistant", msg.stopReason === "aborted" ? "assistant: (aborted)" : msg.stopReason === "error" ? "assistant: (error)" : "assistant: (no content)", undefined, msg.stopReason === "error");
        }
      } else if (msg.role === "toolResult") {
        const call = originatingCall(entry, msg.toolCallId);
        add("tool_result", call ? `tool: ${call.name} ${toolTarget(call)}`.trim() : `tool: ${msg.toolName ?? "tool"}`, undefined, msg.isError === true);
      } else if (msg.role === "bashExecution") {
        add("tool_call", "bash: " + preview(msg.command)); // No command output.
      } else if (msg.role === "system") {
        add("system", "[system]"); // Never retain the system prompt or tool declarations.
      } else add("metadata", `[${msg.role}]`);
    } else if (entry.type === "compaction") add("metadata", "[compaction]", entry.summary);
    else if (entry.type === "branch_summary") add("metadata", "[branch summary]: " + preview(entry.summary), entry.summary);
    else if (entry.type === "custom_message") {
      const body = entry.display ? textContent(entry.content) : "";
      add("metadata", `[${entry.customType}]: ${preview(body)}`, body);
    } else if (entry.type === "model_change") add("metadata", `[model: ${entry.modelId}]`);
    else if (entry.type === "thinking_level_change") add("metadata", `[thinking level: ${entry.thinkingLevel}]`);
    else if (entry.type === "label") add("metadata", `[label: ${entry.label ?? "cleared"}]`);
    else if (entry.type === "session_info") add("metadata", `[title: ${entry.name ?? "empty"}]`);
    else if (entry.type === "custom") add("metadata", `[custom: ${entry.customType}]`);
    else if (entry.type === "context_edit") add("metadata", `[context ${entry.replacement === null ? "omit" : "replace"}]`);
    else add("metadata", `[${entry.type}]`);
    parts.set(entry.id, nodes);
  }
  const nodes: EventNode[] = [];
  for (const entry of entries) {
    const list = parts.get(entry.id) ?? [];
    let parent = entry.parentId ? parts.get(entry.parentId)?.at(-1)?.id ?? null : null;
    for (const node of list) { node.parentId = parent; nodes.push(node); parent = node.id; }
  }
  return { nodes, currentId: leafId ? parts.get(leafId)?.at(-1)?.id ?? null : null };
}

/** Display-only user sections: hide a closed user's work, never later questions or raw links. */
export function userSections(nodes: readonly EventNode[], expanded: ReadonlySet<string>, query = ""): {
  nodes: EventNode[]; ownerFor: Map<string, string | null>; openUsers: Set<string>;
} {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ownerFor = new Map<string, string | null>();
  for (const node of nodes) {
    const path: string[] = [], seen = new Set<string>();
    let cursor: EventNode | undefined = node, owner: string | null = null;
    while (cursor && !seen.has(cursor.id)) {
      if (ownerFor.has(cursor.id)) { owner = ownerFor.get(cursor.id)!; break; }
      if (cursor.kind === "user") { owner = cursor.id; ownerFor.set(cursor.id, owner); break; }
      path.push(cursor.id); seen.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const id of path) ownerFor.set(id, owner);
  }
  const q = query.trim().toLocaleLowerCase("vi");
  const matches = new Set(q ? nodes.filter(node => `${node.title} ${node.body ?? ""}`.toLocaleLowerCase("vi").includes(q)).map(node => node.id) : []);
  const openUsers = new Set(expanded);
  for (const node of nodes) if (matches.has(node.id) && node.kind !== "user") {
    const owner = ownerFor.get(node.id); if (owner) openUsers.add(owner);
  }
  const keep = new Set(nodes.filter(node => node.kind === "user" || openUsers.has(ownerFor.get(node.id) ?? "") || matches.has(node.id)).map(node => node.id));
  const parentFor = new Map<string, string | null>();
  const parent = (id: string | null): string | null => {
    const path: string[] = [], seen = new Set<string>();
    let cursor = id;
    while (cursor && !keep.has(cursor) && !parentFor.has(cursor) && !seen.has(cursor)) {
      path.push(cursor); seen.add(cursor); cursor = byId.get(cursor)?.parentId ?? null;
    }
    const result = cursor && keep.has(cursor) ? cursor : cursor ? parentFor.get(cursor) ?? null : null;
    for (const item of path) parentFor.set(item, result);
    return result;
  };
  return { nodes: nodes.filter(node => keep.has(node.id)).map(node => ({ ...node, parentId: parent(node.parentId) })), ownerFor, openUsers };
}

/** Display-only compression: never cross a fork, response text, tool or failed thinking. */
export function groupThinking(nodes: readonly EventNode[]): { nodes: EventNode[]; groupFor: Map<string, string> } {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string, EventNode[]>();
  for (const node of nodes) if (node.parentId) {
    const list = children.get(node.parentId) ?? []; list.push(node); children.set(node.parentId, list);
  }
  const eligible = (node: EventNode | undefined) => node?.kind === "thinking" && !node.error;
  const groupFor = new Map<string, string>(), groups = new Map<string, EventNode>();
  for (const node of nodes) {
    if (!eligible(node)) continue;
    const previous = node.parentId ? byId.get(node.parentId) : undefined;
    if (eligible(previous) && children.get(previous!.id)?.length === 1) continue;
    const members = [node], seen = new Set([node.id]);
    let cursor = node;
    while (children.get(cursor.id)?.length === 1) {
      const next = children.get(cursor.id)![0];
      if (!eligible(next) || seen.has(next.id)) break;
      members.push(next); seen.add(next.id); cursor = next;
    }
    const id = JSON.stringify(["thinking-group", node.id]);
    groups.set(id, { id, parentId: node.parentId, entryId: node.entryId, kind: "thinking_group", title: members.length > 1 ? `thinking · ${members.length} mục` : "thinking", members });
    for (const member of members) groupFor.set(member.id, id);
  }
  const display: EventNode[] = [];
  const parent = (id: string | null) => id ? groupFor.get(id) ?? id : null;
  for (const node of nodes) {
    const groupId = groupFor.get(node.id);
    if (!groupId) display.push({ ...node, parentId: parent(node.parentId) });
    else {
      const group = groups.get(groupId)!;
      if (group.members![0].id === node.id) display.push({ ...group, parentId: parent(group.parentId) });
    }
  }
  return { nodes: display, groupFor };
}

/** Find the closest real user ancestor of the actual current leaf, not the latest stored branch. */
export function latestUserOnPath(nodes: readonly EventNode[], currentId: string | null): string | null {
  const byId = new Map(nodes.map(node => [node.id, node])), seen = new Set<string>();
  let cursor = currentId ? byId.get(currentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.kind === "user") return cursor.id;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return null;
}

/** Flat rows preserve the raw branch graph, indenting only real splits. */
export function eventRows(nodes: readonly EventNode[], query: string, collapsed: ReadonlySet<string>): EventRow[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string | null, EventNode[]>();
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const list = children.get(parent) ?? []; list.push(node); children.set(parent, list);
  }
  const q = query.trim().toLocaleLowerCase("vi");
  const matches = new Set(nodes.filter(node => !q || [node.title, node.body ?? "", ...(node.members ?? []).map(member => `${member.title} ${member.body ?? ""}`)].join(" ").toLocaleLowerCase("vi").includes(q)).map(node => node.id));
  const keep = new Set<string>();
  if (!q) for (const node of nodes) keep.add(node.id);
  else for (const id of matches) {
    let cursor = byId.get(id);
    while (cursor && !keep.has(cursor.id)) { keep.add(cursor.id); cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined; }
  }
  const rows: EventRow[] = [], visited = new Set<string>();
  const roots = children.get(null) ?? (nodes[0] ? [nodes[0]] : []);
  const stack = roots.toReversed().map(node => ({ node, lane: "", marker: "" }));
  while (stack.length) {
    const item = stack.pop()!;
    if (visited.has(item.node.id) || !keep.has(item.node.id)) continue;
    visited.add(item.node.id);
    const below = children.get(item.node.id) ?? [];
    rows.push({ node: item.node, prefix: item.lane + item.marker, ancestor: !!q && !matches.has(item.node.id), hasChildren: below.length > 0 });
    if (!q && collapsed.has(item.node.id)) continue;
    const visible = below.filter(node => keep.has(node.id));
    const lane = item.lane + (item.marker === "├─ " ? "│  " : item.marker === "└─ " ? "   " : "");
    for (let i = visible.length - 1; i >= 0; i--) stack.push({ node: visible[i], lane, marker: visible.length > 1 ? i === visible.length - 1 ? "└─ " : "├─ " : "" });
  }
  return rows;
}

/** Explicit fixture only for /tree-v2 sample; thinking is labelled synthetic. */
export function sampleEvents(): { entries: SessionEntry[]; leafId: string | null } {
  const entries: SessionEntry[] = [], ends = new Map<string, string>();
  for (const turn of sampleHistory()) {
    let parent = turn.parentId ? ends.get(turn.parentId) ?? null : null;
    const push = (suffix: string, message: unknown) => {
      const id = `${turn.id}-${suffix}`;
      entries.push({ type: "message", id, parentId: parent, timestamp: "2026-01-01T12:00:00Z", message } as SessionEntry);
      parent = id;
    };
    push("user", { role: "user", content: turn.prompt });
    push("work", { role: "assistant", stopReason: "toolUse", content: [
      { type: "thinking", thinking: "Thinking minh họa: kiểm tra yêu cầu và cách thực hiện." },
      { type: "text", text: "Mình sẽ kiểm tra phần liên quan." },
      ...turn.tools.map((tool, index) => ({ type: "toolCall", id: `${turn.id}-call-${index}`, name: tool.name, arguments: tool.name === "bash" ? { command: tool.target } : { path: tool.target } })),
    ] });
    turn.tools.forEach((tool, index) => push(`result-${index}`, { role: "toolResult", toolCallId: `${turn.id}-call-${index}`, toolName: tool.name, isError: !!tool.error, content: [{ type: "text", text: tool.result }] }));
    push("reply", { role: "assistant", stopReason: turn.status === "aborted" ? "aborted" : "stop", content: turn.status === "aborted" ? [] : [{ type: "text", text: turn.answer }] });
    ends.set(turn.id, parent!);
  }
  return { entries, leafId: entries.at(-1)?.id ?? null };
}
