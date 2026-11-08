import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  Input, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi,
  type Component, type Focusable, type KeybindingsManager, type KeyId, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { eventRows, groupThinking, latestUserOnPath, userSections, type EventNode, type EventRow } from "./tree-events.ts";

export type TreeTarget = { entryId: string; nodeId: string };
type HistoryOptions = { currentId?: string | null; live?: boolean; selectedId?: string; onNavigate?: (target: TreeTarget) => void; getTheme?: () => Theme };
type Hit = { id: string; kind: "node" | "content"; fold?: [number, number] };
type Tone = "text" | "muted" | "accent" | "error" | "thinking" | "tool";
type Line = { text: string; tone: Tone; id: string; header?: boolean; hit: Hit };
const fit = (s: string, width: number) => truncateToWidth(s, Math.max(0, width), "…", true);
const displayText = (s: string) => stripTerminalSequences(s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const assistantExcerpt = (body: string) => {
  // Skip standalone Markdown headings so the excerpt contains an actual paragraph.
  const paragraph = body.trim().split(/\n\s*\n/)
    .map(part => part.replace(/^(?:[ \t]*#{1,6}[ \t]+[^\n]*(?:\n|$))+/, "").trim())
    .find(Boolean) ?? body.trim();
  return paragraph.replace(/\s+/g, " ").trim() + (paragraph !== body.trim() ? "…" : "");
};

/** Raw events stay separate; closed questions hide only their own work in the display. */
export class SessionTreeView implements Component, Focusable {
  readonly capturesViewportInput = true;
  private hasFocus = false;
  private search = new Input({ prompt: "", placeholder: "Tìm trong cây…" });
  private searching = false;
  private query = "";
  private selectedId: string;
  private currentId: string;
  private live: boolean;
  private collapsed = new Set<string>();
  private expandedIds = new Set<string>();
  private assistantPreviews = new Set<string>();
  private expandedUsers = new Set<string>();
  private openUsers = new Set<string>();
  private ownerFor = new Map<string, string | null>();
  private expandedGroups = new Set<string>();
  private groupedNodes: EventNode[] = [];
  private groupFor = new Map<string, string>();
  private defaultUserId: string | null;
  private rows: EventRow[] = [];
  private documentLines: Line[] = [];
  private hits = new Map<number, Hit>();
  private offset = 0;
  private maxOffset = 0;
  private bodyHeight = 12;
  private anchor: "selection" | "top" | undefined = "top";
  private closed = false;
  private nodes: EventNode[];
  private theme: Theme;
  private keybindings: Pick<KeybindingsManager, "matches">;
  private height: () => number;
  private repaint: () => void;
  private done: () => void;
  private onNavigate?: (target: TreeTarget) => void;
  private getTheme?: () => Theme;

  constructor(
    nodes: EventNode[], theme: Theme, keybindings: Pick<KeybindingsManager, "matches">,
    height: () => number, repaint: () => void, done: () => void, options: HistoryOptions = {},
  ) {
    this.nodes = nodes; this.theme = theme; this.keybindings = keybindings;
    this.height = height; this.repaint = repaint; this.done = done; this.onNavigate = options.onNavigate; this.getTheme = options.getTheme;
    this.live = options.live ?? false;
    this.currentId = options.currentId === undefined ? nodes.at(-1)?.id ?? "" : options.currentId ?? "";
    this.defaultUserId = latestUserOnPath(nodes, this.currentId || null);
    if (this.defaultUserId) this.setUserOpen(this.defaultUserId, true);
    for (const node of nodes) if (node.kind === "thinking" && node.error && node.body) this.expandedIds.add(node.id);
    this.selectedId = options.selectedId ?? this.defaultUserId ?? this.currentId;
    this.refresh();
    if (options.selectedId) {
      const allGroups = groupThinking(nodes);
      const selected = nodes.find(node => node.id === options.selectedId) ?? allGroups.nodes.find(node => node.id === options.selectedId);
      const owner = selected && this.ownerFor.get(selected.members?.[0]?.id ?? selected.id);
      if (owner) this.setUserOpen(owner, true);
      const group = allGroups.groupFor.get(options.selectedId);
      if (group) this.expandedGroups.add(group);
      this.selectedId = options.selectedId; this.refresh();
    }
    // Keep the current response preview on the assistant header; Space/click reads the full body.
    if (this.defaultUserId) for (const node of nodes) {
      if (node.kind === "assistant" && node.body && this.ownerFor.get(node.id) === this.defaultUserId) {
        this.expandedIds.add(node.id); this.assistantPreviews.add(node.id);
      }
    }
  }
  get focused() { return this.hasFocus; }
  set focused(value: boolean) { this.hasFocus = value; this.search.focused = value && this.searching; }
  invalidate() { this.search.invalidate(); }
  dispose() { this.closed = true; this.search.focused = false; this.hits.clear(); this.documentLines = []; this.expandedIds.clear(); this.assistantPreviews.clear(); this.expandedUsers.clear(); this.openUsers.clear(); this.ownerFor.clear(); this.expandedGroups.clear(); this.groupFor.clear(); this.groupedNodes = []; }
  private close() { if (!this.closed) { this.dispose(); this.done(); } }
  private isFolded(id: string) { return this.collapsed.has(id) && !this.query.trim(); }
  private matches(node: EventNode) {
    const q = this.query.trim().toLocaleLowerCase("vi");
    return !!q && `${node.title} ${node.body ?? ""}`.toLocaleLowerCase("vi").includes(q);
  }
  private groupOpen(node: EventNode) {
    return this.expandedGroups.has(node.id) || (!!this.query.trim() && !!node.members?.some(member => this.matches(member)));
  }
  private setUserOpen(id: string, open: boolean) {
    if (open) { this.expandedUsers.add(id); this.expandedIds.add(id); }
    else { this.expandedUsers.delete(id); this.expandedIds.delete(id); }
    this.collapsed.delete(id);
  }
  private keepOwnerOpen(node: EventNode) {
    const owner = this.ownerFor.get(node.members?.[0]?.id ?? node.id);
    if (owner) this.setUserOpen(owner, true);
  }
  private refresh() {
    const sections = userSections(this.nodes, this.expandedUsers, this.query);
    this.ownerFor = sections.ownerFor; this.openUsers = sections.openUsers;
    const grouped = groupThinking(sections.nodes);
    this.groupedNodes = grouped.nodes; this.groupFor = grouped.groupFor;
    this.rows = [];
    for (const row of eventRows(this.groupedNodes, this.query, this.collapsed)) {
      if (!row.node.members) { this.rows.push(row.node.kind === "user" ? { ...row, hasChildren: true } : row); continue; }
      this.rows.push({ ...row, hasChildren: true, ancestor: !!this.query.trim() && (row.ancestor || !this.matches(row.node)) });
      if (this.groupOpen(row.node)) {
        const lane = row.prefix.replace("├─ ", "│  ").replace("└─ ", "   ") + "   ";
        row.node.members.forEach((member, index, members) => this.rows.push({
          node: { ...member, parentId: row.node.id }, prefix: lane + (index === members.length - 1 ? "└─ " : "├─ "),
          ancestor: !!this.query.trim() && !this.matches(member), hasChildren: false,
        }));
      }
    }
    if (!this.rows.some(row => row.node.id === this.selectedId)) {
      const group = this.groupFor.get(this.selectedId);
      if (group && this.rows.some(row => row.node.id === group)) this.selectedId = group;
      else this.selectedId = (this.rows.find(row => !row.ancestor && row.node.kind !== "thinking_group") ?? this.rows.find(row => !row.ancestor) ?? this.rows[0])?.node.id ?? "";
    }
  }
  private change() { this.refresh(); this.invalidate(); this.repaint(); }
  private select(index: number) { this.selectedId = this.rows[Math.max(0, Math.min(this.rows.length - 1, index))]?.node.id ?? ""; this.anchor = "selection"; }
  private confirm() {
    if (!this.onNavigate) { this.activate(); return; }
    const node = this.rows.find(row => row.node.id === this.selectedId)?.node;
    if (!node) return;
    // Display blocks map back to persisted entries; a closed thinking group targets its final member.
    const target = node.members?.at(-1) ?? node;
    const navigate = this.onNavigate;
    this.dispose(); navigate({ entryId: target.entryId, nodeId: node.id });
  }
  private activate() {
    const node = this.rows.find(row => row.node.id === this.selectedId)?.node;
    if (node?.kind === "user") {
      this.setUserOpen(node.id, !this.expandedUsers.has(node.id));
      this.query = ""; this.search.setValue(""); this.anchor = "top";
    } else if (node?.members) {
      this.keepOwnerOpen(node);
      if (this.expandedGroups.has(node.id)) this.expandedGroups.delete(node.id); else this.expandedGroups.add(node.id);
      this.anchor = "top";
    } else if (node?.body) {
      this.keepOwnerOpen(node);
      if (node.kind === "assistant" && this.expandedIds.has(node.id) && this.assistantPreviews.has(node.id)) this.assistantPreviews.delete(node.id);
      else if (this.expandedIds.has(node.id)) this.expandedIds.delete(node.id); else this.expandedIds.add(node.id);
      this.collapsed.delete(node.id); this.anchor = "top";
    }
  }
  private fold(id: string) {
    const row = this.rows.find(row => row.node.id === id);
    if (this.query.trim() || !row?.hasChildren) return;
    if (row.node.kind === "user") this.setUserOpen(id, !this.expandedUsers.has(id));
    else if (row.node.members) {
      this.keepOwnerOpen(row.node);
      if (this.expandedGroups.has(id)) this.expandedGroups.delete(id); else this.expandedGroups.add(id);
    } else if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.anchor = "selection";
  }
  private scroll(delta: number) { this.offset = Math.max(0, Math.min(this.maxOffset, this.offset + delta)); this.anchor = undefined; }

  handleInput(data: string) {
    if (this.closed) return;
    const is = (key: KeyId) => matchesKey(data, key);
    const cancel = this.keybindings.matches(data, "tui.select.cancel"), confirm = this.keybindings.matches(data, "tui.select.confirm");
    if (is("ctrl+c")) { this.close(); return; }
    if (this.searching) {
      if (cancel || confirm) { this.searching = false; this.search.focused = false; if (confirm) this.confirm(); }
      else { this.search.handleInput(data); this.query = this.search.getValue(); this.selectedId = ""; this.refresh(); this.anchor = "selection"; }
      if (!this.closed) this.change(); return;
    }
    if (cancel) { this.close(); return; }
    const index = this.rows.findIndex(row => row.node.id === this.selectedId), row = this.rows[index];
    if (this.keybindings.matches(data, "tui.select.up")) this.select(index - 1);
    else if (this.keybindings.matches(data, "tui.select.down")) this.select(index + 1);
    else if (confirm) { this.confirm(); if (this.closed) return; }
    else if (data === " ") this.activate();
    else if (data === "/") { this.searching = true; this.search.focused = this.focused; }
    else if (is("pageUp") || is("pageDown")) this.scroll((is("pageUp") ? -1 : 1) * this.bodyHeight);
    else if (is("ctrl+home")) this.scroll(-this.maxOffset);
    else if (is("ctrl+end")) this.scroll(this.maxOffset);
    else if (is("home")) this.select(0);
    else if (is("end")) this.select(this.rows.length - 1);
    else if (is("left") && row) {
      if (row.node.kind === "user") {
        if (!this.query.trim() && this.openUsers.has(row.node.id)) this.fold(row.node.id);
        else if (row.node.parentId) this.select(this.rows.findIndex(parent => parent.node.id === row.node.parentId));
      } else if (row.node.members) {
        if (!this.query.trim() && this.groupOpen(row.node)) { this.expandedGroups.delete(row.node.id); this.anchor = "selection"; }
        else if (row.node.parentId) this.select(this.rows.findIndex(parent => parent.node.id === row.node.parentId));
      } else if (!this.query.trim() && !this.isFolded(row.node.id) && row.hasChildren) this.fold(row.node.id);
      else if (row.node.parentId) this.select(this.rows.findIndex(parent => parent.node.id === row.node.parentId));
    } else if (is("right") && row) {
      if (row.node.kind === "user" && !this.openUsers.has(row.node.id)) { this.setUserOpen(row.node.id, true); this.anchor = "selection"; }
      else if (row.node.members && !this.groupOpen(row.node)) { this.keepOwnerOpen(row.node); this.expandedGroups.add(row.node.id); this.anchor = "selection"; }
      else if (this.collapsed.has(row.node.id)) { this.collapsed.delete(row.node.id); this.anchor = "selection"; }
      else if (this.rows[index + 1]?.node.parentId === row.node.id) this.select(index + 1);
    } else if (is("backspace")) {
      if (row?.node.kind === "user") { this.setUserOpen(row.node.id, false); this.anchor = "selection"; }
      else if (this.expandedIds.delete(this.selectedId) || this.expandedGroups.delete(this.selectedId)) this.anchor = "selection";
      else return;
    }
    else return;
    this.change();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.closed || event.x < 0 || event.y < 0 || event.x >= event.width || event.y >= event.height) return;
    if (event.type === "wheel") { this.scroll(Math.sign(event.wheelDelta ?? 0) * 3); this.change(); return { handled: true }; }
    if (event.type !== "click" || event.button !== "left") return;
    if (event.y === 2) { this.searching = true; this.search.focused = this.focused; }
    else {
      const hit = this.hits.get(event.y); if (!hit) return;
      this.searching = false; this.search.focused = false; this.selectedId = hit.id;
      if (hit.fold && event.x >= hit.fold[0] && event.x < hit.fold[1]) this.fold(hit.id);
      else if (hit.kind === "node") this.activate();
    }
    this.change(); return { handled: true, focus: true };
  }

  render(width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(1, Math.floor(this.height())), th = this.getTheme?.() ?? this.theme;
    const colors: Record<Tone | "border", ThemeColor> = {
      text: "text", muted: "muted", accent: "accent", error: "error",
      thinking: "thinkingText", tool: "toolTitle", border: "borderAccent",
    };
    const ink = (s: string, tone: Tone | "border" = "text", selected = false, bold = false) => th.style(fit(s, width), {
      fg: colors[tone], bg: selected ? "selectedBg" : "customMessageBg", bold,
    });
    this.hits.clear();
    if (width < 32 || height < 10) return [ink("Session tree · Từng sự kiện"), ink("Tăng kích thước terminal. Esc đóng.", "muted")].slice(0, height);
    this.refresh(); this.bodyHeight = height - 6;
    const lines = [
      ink("  Session tree · Từng sự kiện", "accent", false, true),
      ink(this.live ? "  Phiên hiện tại · Chỉ mở user cuối nhánh · ● Hiện tại" : "  Dữ liệu mẫu · Chỉ mở user cuối nhánh", "muted"),
    ];
    if (this.searching) {
      const bg = th.getBgAnsi("customMessageBg");
      const input = (this.search.render(width - 4)[0] ?? "").replace(/\x1b\[(?:0|49)m/g, sequence => sequence + bg);
      lines.push(th.style("  / ", { fg: colors.accent, bg: "customMessageBg" }) + bg + fit(input, width - 4) + "\x1b[49m");
    } else lines.push(ink(`  / ${this.query || "Tìm user, assistant, thinking, tool hoặc tên file…"}`, this.query ? "accent" : "muted"));
    lines.push(ink("─".repeat(width), "border"));
    const document: Line[] = [], nodeLines = new Map<string, number>();
    for (const row of this.rows) {
      const node = row.node, selected = node.id === this.selectedId;
      const fold = node.kind === "user" ? this.openUsers.has(node.id) ? "▾" : "▸" : node.members ? this.groupOpen(node) ? "▾" : "▸" : row.hasChildren ? this.isFolded(node.id) ? "▸" : "▾" : "·";
      const isCurrent = node.id === this.currentId || (!!node.members?.some(member => member.id === this.currentId) && !this.groupOpen(node)) || (node.kind === "user" && node.id === this.defaultUserId && !this.openUsers.has(node.id));
      const current = isCurrent ? width >= 90 ? " ● Hiện tại" : " ●" : "";
      const owner = this.ownerFor.get(node.members?.[0]?.id ?? node.id);
      const sectionIndent = node.kind !== "user" && owner ? "  " : "";
      const branch = truncateToWidth(row.prefix + sectionIndent, Math.max(0, width - visibleWidth(current) - 16), "…");
      const lead = ` ${selected ? ">" : " "} ${branch}`, beginning = `${lead}${fold} `;
      const hit: Hit = { id: node.id, kind: "node" };
      if (row.hasChildren) hit.fold = [visibleWidth(lead), visibleWidth(lead) + 2];
      const tone: Tone = node.error ? "error" : row.ancestor ? "muted" : node.kind === "user" ? "accent" : node.kind === "assistant" ? "text"
        : node.kind === "thinking" || node.kind === "thinking_group" ? "thinking" : node.kind === "tool_call" || node.kind === "tool_result" ? "tool" : "muted";
      nodeLines.set(node.id, document.length);
      const bodyOpen = this.expandedIds.has(node.id) && !!node.body && !this.isFolded(node.id);
      const inlinePreview = node.kind === "assistant" && bodyOpen && this.assistantPreviews.has(node.id);
      const title = inlinePreview ? `assistant: ${assistantExcerpt(displayText(node.body!))}`
        : node.kind === "assistant" && bodyOpen ? "assistant:" : displayText(node.title);
      const room = Math.max(1, width - visibleWidth(beginning) - visibleWidth(current) - 1);
      document.push({ text: beginning + fit(title, room) + " " + current,
        id: node.id, header: true, hit, tone });
      // Short questions are already complete in the header; don't print them twice.
      const bodyTitle = `user: ${displayText(node.body ?? "")}`;
      const userBodyNeeded = node.kind !== "user" || /[\r\n]/.test(node.body ?? "") || visibleWidth(bodyTitle) > Math.min(room, visibleWidth(title));
      if (bodyOpen && !inlinePreview && node.body && userBodyNeeded) {
        const lane = "   " + branch.replace("├─ ", "│  ").replace("└─ ", "   ") + "    ";
        const prefix = truncateToWidth(lane, Math.max(0, width - 12));
        const body = displayText(node.body), bodyWidth = Math.max(1, width - visibleWidth(prefix) - 1);
        const bodyLines = wrapTextWithAnsi(body, bodyWidth);
        for (const text of bodyLines) document.push({
          text: prefix + text, id: node.id, tone: "text", hit: { id: node.id, kind: "content" },
        });
      }
    }
    this.documentLines = document; this.maxOffset = Math.max(0, document.length - this.bodyHeight);
    const at = nodeLines.get(this.selectedId);
    if (at !== undefined && this.anchor) {
      if (this.anchor === "top") this.offset = at;
      else if (at < this.offset) this.offset = at;
      else if (at >= this.offset + this.bodyHeight) this.offset = at - this.bodyHeight + 1;
    }
    this.anchor = undefined; this.offset = Math.max(0, Math.min(this.offset, this.maxOffset));
    for (let y = 0; y < this.bodyHeight; y++) {
      const line = document[this.offset + y];
      if (line) {
        lines.push(ink(line.text, line.tone, line.header && line.id === this.selectedId, line.header && line.id === this.selectedId));
        this.hits.set(4 + y, line.hit);
      } else lines.push(ink(!document.length && y === 0 ? this.query ? "  Không tìm thấy mục nào. Nhấn / để tìm lại." : "  Chưa có sự kiện trong phiên này." : "", "muted"));
    }
    lines.push(ink("─".repeat(width), "border"));
    lines.push(ink(this.searching ? this.onNavigate ? "  Nhập để tìm · Enter Chuyển tới · Esc Xong" : "  Nhập để tìm · Enter Xem · Esc Xong" : this.onNavigate
      ? width >= 100 ? "  ↑↓ Chọn · Enter Chuyển tới · Space/click Bung/thu · ←→ Nhánh · / Tìm · Esc Đóng"
        : "  Enter Chuyển tới · Space Bung/thu · / Tìm · Esc Đóng"
      : width >= 100 ? "  ↑↓ Chọn · ←→ Nhánh · Enter/Space Xem/thu · PgUp/PgDn Cuộn · / Tìm · Esc Đóng"
        : "  ↑↓ Chọn · Enter/Space Xem/thu · / Tìm · Esc Đóng", "accent"));
    return lines.map(line => truncateToWidth(line, width));
  }
}
