import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ═══════════════════════════════════════════════════════════════════════════════
//  Aurora UI Extension — Borderless Input + Custom Footer
//  • Startup banner (tự ẩn sau 5s)
//  • Borderless editor: không vẽ khung để terminal copy sạch
//    - Top status: context/cwd (left) + model/thinking/session (right)
//    - Bottom status: ChatGPT usage
//  • Minimal footer: chỉ hiển thị extension statuses
//  • Custom working messages cho tool execution
//  • /aurora-themes, Ctrl+Shift+T
// ═══════════════════════════════════════════════════════════════════════════════

type GitWorkingTreeStats = {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
};

export default function (pi: ExtensionAPI) {
  let gitBranch: string | null = null;
  let gitStats: GitWorkingTreeStats | null = null;
  let refreshingGitStats = false;
  const sessionCleanups = new Set<() => void>();

  const addSessionCleanup = (cleanup: () => void) => {
    sessionCleanups.add(cleanup);
    return () => sessionCleanups.delete(cleanup);
  };

  pi.on("session_shutdown", async () => {
    for (const cleanup of sessionCleanups) {
      try { cleanup(); } catch { /* best-effort cleanup */ }
    }
    sessionCleanups.clear();
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SESSION START                                               ║
  // ╚══════════════════════════════════════════════════════════════╝
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const cwd = ctx.cwd;
    let disposed = false;
    let gitStatsTimer: ReturnType<typeof setInterval> | undefined;
    let bannerTimer: ReturnType<typeof setTimeout> | undefined;
    let currentEditor: AuroraEditor | null = null;

    const unregisterCleanup = addSessionCleanup(() => {
      disposed = true;
      if (bannerTimer) clearTimeout(bannerTimer);
      if (gitStatsTimer) clearInterval(gitStatsTimer);
    });

    // ── Startup Banner ──────────────────────────────────────────
    showBanner(ctx);
    bannerTimer = setTimeout(() => {
      if (disposed) return;
      try { ctx.ui.setWidget("aurora-banner", undefined); } catch { /* ctx may be stale during session replacement */ }
    }, 5000);

    // ── Borderless Editor ───────────────────────────────────────
    // CustomEditor constructor: (tui, theme, keybindings, options?)
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      currentEditor = new AuroraEditor(tui, theme, keybindings, pi, ctx, cwd, () => gitBranch, () => gitStats);
      return currentEditor;
    });

    let requestRender = () => {};
    const refreshGitStats = async () => {
      if (disposed || refreshingGitStats) return;
      refreshingGitStats = true;
      try {
        gitStats = await readGitWorkingTreeStats(pi, cwd);
        if (!disposed) requestRender();
      } finally {
        refreshingGitStats = false;
      }
    };

    void refreshGitStats();
    gitStatsTimer = setInterval(refreshGitStats, 2500);

    // ── Minimal Footer (chỉ extension statuses) ────────────────
    ctx.ui.setFooter((tui, _theme, footerData) => {
      requestRender = () => {
        tui.requestRender();
      };

      const branchDispose = footerData.onBranchChange(() => {
        gitBranch = footerData.getGitBranch();
        void refreshGitStats();
        tui.requestRender();
      });

      return {
        dispose: () => {
          disposed = true;
          if (bannerTimer) clearTimeout(bannerTimer);
          if (gitStatsTimer) clearInterval(gitStatsTimer);
          branchDispose();
          unregisterCleanup();
        },
        invalidate() {},
        render(w: number): string[] {
          gitBranch = footerData.getGitBranch();
          let statusLine: string | undefined;
          try {
            const parts = [...(footerData.getExtensionStatuses?.() ?? new Map()).values()];
            if (parts.length > 0) statusLine = parts.join("  ");
          } catch { /* footer data can be transient during session switch */ }

          // Reuse fullscreen's reserved footer row for the unframed usage status.
          if (isFullscreenTui(tui) && currentEditor) {
            const lines: string[] = [];
            const usageLine = currentEditor.renderFooterStatus(w);
            if (usageLine) lines.push(usageLine);
            if (statusLine) lines.push(statusLine);
            return lines;
          }

          return statusLine ? [statusLine] : [];
        },
      };
    });
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  EVENTS                                                      ║
  // ╚══════════════════════════════════════════════════════════════╝

  pi.on("agent_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingMessage("◈  suy nghĩ…");
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (!ctx.hasUI) return;
    const labels: Record<string, string> = {
      bash: "⟩  chạy lệnh…",
      read: "◎  đọc file…",
      write: "◉  ghi file…",
      edit: "⊙  sửa file…",
      grep: "⊹  tìm kiếm…",
      find: "⊿  duyệt thư mục…",
      ls: "≡  liệt kê…",
    };
    ctx.ui.setWorkingMessage(labels[event.toolName] ?? `◌  ${event.toolName}…`);
  });

  pi.on("model_select", async (event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.notify(
      `⬡ ${event.model.provider}/${event.model.id}`,
      "info"
    );
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!ctx.hasUI || !event.isError) return;
    ctx.ui.notify(`✗ ${event.toolName} thất bại`, "error");
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  COMMANDS & SHORTCUTS                                        ║
  // ╚══════════════════════════════════════════════════════════════╝

  pi.registerCommand("aurora-themes", {
    description: "Chọn theme nhanh",
    handler: async (_args, ctx) => {
      const names = ctx.ui.getAllThemes().map((t: any) => t.name);
      const chosen = await ctx.ui.select("🎨  Chọn theme:", names);
      if (!chosen) return;
      const r = ctx.ui.setTheme(chosen);
      ctx.ui.notify(r.success ? `✓ Theme: ${chosen}` : `✗ ${r.error}`, r.success ? "info" : "error");
    },
  });

  pi.registerShortcut("ctrl+shift+t", {
    description: "Chọn theme nhanh",
    handler: async (_key, ctx) => {
      const names = ctx.ui.getAllThemes().map((t: any) => t.name);
      const chosen = await ctx.ui.select("🎨  Chọn theme:", names);
      if (!chosen) return;
      const r = ctx.ui.setTheme(chosen);
      if (r.success) ctx.ui.notify(`✓ ${chosen}`, "info");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AuroraEditor — Input không khung để terminal copy không kèm ký tự trang trí
//
//  Layout:
//  7% of 300k  ·  ~/Desktop/project (main)          sonnet  ·  ◑ medium
//  > type your prompt here_
//  ChatGPT  ·  usage
// ═══════════════════════════════════════════════════════════════════════════════

class AuroraEditor extends CustomEditor {
  private piRef: ExtensionAPI;
  private ctxRef: any;
  private cwd: string;
  private getBranch: () => string | null;
  private getGitStats: () => GitWorkingTreeStats | null;

  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    pi: ExtensionAPI,
    ctx: any,
    cwd: string,
    getBranch: () => string | null,
    getGitStats: () => GitWorkingTreeStats | null,
  ) {
    // CustomEditor constructor: (tui, theme, keybindings, options?)
    super(tui, theme, keybindings);
    this.piRef = pi;
    this.ctxRef = ctx;
    this.cwd = cwd;
    this.getBranch = getBranch;
    this.getGitStats = getGitStats;
  }

  render(width: number): string[] {
    const t = getSafeTheme(this.ctxRef);

    // Use the full width now that content rows have no vertical frame.
    const allLines = super.render(Math.max(1, width));

    // super.render() returns: [topBorder, ...contentLines, bottomBorder, ...autocompleteLines]
    // We need to strip the Editor's own top/bottom borders (─────) and keep
    // only the content lines + autocomplete lines.
    // Top border = first line (always a ─── line)
    // Bottom border = find the second ─── line after content
    let topBorderIdx = 0; // always index 0
    let bottomBorderIdx = -1;

    // Find the bottom border: scan from index 1 for the next full-width ─── line
    for (let i = 1; i < allLines.length; i++) {
      const stripped = allLines[i].replace(/\x1b\[[^m]*m/g, ""); // strip ANSI
      if (/^[─↓ ]+$/.test(stripped) && stripped.includes("─")) {
        bottomBorderIdx = i;
        break;
      }
    }

    // Content lines = between top and bottom border
    const contentLines = bottomBorderIdx > 0
      ? allLines.slice(topBorderIdx + 1, bottomBorderIdx)
      : allLines.slice(topBorderIdx + 1);

    // Autocomplete lines = after bottom border (if any)
    const autocompleteLines = bottomBorderIdx > 0
      ? allLines.slice(bottomBorderIdx + 1)
      : [];

    const result: string[] = [];

    // ── Unframed status with badges ──
    const topStatus = this.topStatusLine(width, t);
    if (topStatus) result.push(topStatus);

    // ── Borderless content lines ──
    // Keep the prompt box readable even when the editor has only one line.
    const minContentRows = 3;
    const visibleContentLines = [...contentLines];
    while (visibleContentLines.length < minContentRows) visibleContentLines.push("");

    for (const line of visibleContentLines) {
      result.push(line);
    }

    // ── Unframed ChatGPT usage status ──
    if (!isFullscreenTui(this.tui)) {
      const bottomStatus = this.bottomStatusLine(width, t);
      if (bottomStatus) result.push(bottomStatus);
    }

    // ── Autocomplete dropdown ──
    for (const line of autocompleteLines) {
      result.push(line);
    }

    return result;
  }

  renderFooterStatus(width: number): string | undefined {
    return this.bottomStatusLine(width, getSafeTheme(this.ctxRef));
  }

  // ─────────────────────────────────────────────────────────────
  //  Top status: context/cwd (left), model/thinking/session (right)
  // ─────────────────────────────────────────────────────────────
  private topStatusLine(w: number, t: any): string {
    const width = Math.max(0, Math.floor(w));
    if (width === 0) return "";

    const separatorRaw = "  ·  ";
    const separatorStyled = t.fg("dim", separatorRaw);

    // ── Left badges: context usage + cwd/branch ──
    const lParts: { raw: string; styled: string }[] = [];

    let usage: ReturnType<typeof this.ctxRef.getContextUsage> | null = null;
    try { usage = this.ctxRef.getContextUsage(); } catch { /* ignore token estimation errors */ }
    if (usage) {
      const pct = Math.round((usage.tokens / usage.contextWindow) * 100);
      const totalK = Math.round(usage.contextWindow / 1000);
      const c = pct > 80 ? "error" : pct > 55 ? "warning" : "success";
      const raw = `${pct}% of ${totalK}k`;
      lParts.push({ raw, styled: t.fg(c, raw) });
    }

    const cwd = this.cwd.replace(/\/home\/[^/]+/, "~");
    const branch = this.getBranch();
    const gitStats = this.getGitStats();
    const gitBadge = formatGitStatsBadge(gitStats);
    const branchRaw = branch ? [branch, gitBadge].filter(Boolean).join(" ") : undefined;
    const cwdRaw = branchRaw ? `${cwd} (${branchRaw})` : cwd;
    const cwdStyled = branchRaw
      ? t.fg("muted", cwd + " ") + t.fg("dim", "(") + t.fg("accent", branch || "") + formatGitStatsStyled(t, gitStats) + t.fg("dim", ")")
      : t.fg("muted", cwd);
    lParts.push({ raw: cwdRaw, styled: cwdStyled });

    // ── Right badges: model ─ thinking ─ session ──
    const rParts: { raw: string; styled: string }[] = [];

    let m: any;
    try { m = this.ctxRef.model; } catch { /* ctx may be stale during session replacement */ }
    if (m) {
      const name = shortModel(m.id);
      rParts.push({ raw: name, styled: t.fg("accent", name) });
    }

    let lv: string | undefined;
    try { lv = this.piRef.getThinkingLevel(); } catch { /* extension api may be stale during session replacement */ }
    if (lv && lv !== "off") {
      const dots: Record<string, string> = {
        minimal: "◌", low: "◔", medium: "◑", high: "◕", xhigh: "●",
      };
      const colors: Record<string, string> = {
        minimal: "dim", low: "muted", medium: "border", high: "accent", xhigh: "error",
      };
      const badge = `${dots[lv] ?? "?"} ${lv}`;
      rParts.push({ raw: badge, styled: t.fg(colors[lv] ?? "muted", badge) });
    }

    let sessionName: string | undefined;
    try { sessionName = this.ctxRef.sessionManager?.getSessionName?.(); } catch { /* ctx may be stale during session replacement */ }
    if (sessionName) {
      rParts.push({ raw: sessionName, styled: t.fg("accent", sessionName) });
    }

    const rRaw = rParts.map(p => p.raw).join(separatorRaw);
    const rStyled = rParts.map(p => p.styled).join(separatorStyled);
    let lRaw = lParts.map(p => p.raw).join(separatorRaw);
    let lStyled = lParts.map(p => p.styled).join(separatorStyled);
    let lW = visibleWidth(lRaw);
    const rW = visibleWidth(rRaw);

    // If the terminal is too narrow, keep context usage and drop cwd first.
    if (rW > 0 && lW + rW + 2 > width && lParts.length > 1) {
      lRaw = lParts[0].raw;
      lStyled = lParts[0].styled;
      lW = visibleWidth(lRaw);
    }

    if (lW > 0 && rW > 0) {
      if (rW >= width) return truncateToWidth(rStyled, width, "");
      const left = truncateToWidth(lStyled, Math.max(0, width - rW - 1), "");
      const gap = Math.max(1, width - visibleWidth(left) - rW);
      return left + " ".repeat(gap) + rStyled;
    }
    if (lW > 0) return truncateToWidth(lStyled, width, "");
    if (rW > 0) {
      const right = truncateToWidth(rStyled, width, "");
      return " ".repeat(Math.max(0, width - visibleWidth(right))) + right;
    }
    return "";
  }

  // ─────────────────────────────────────────────────────────────
  //  Bottom status: ChatGPT usage
  // ─────────────────────────────────────────────────────────────
  private bottomStatusLine(w: number, t: any): string | undefined {
    const width = Math.max(0, Math.floor(w));
    if (width === 0) return;

    // ChatGPT subscription usage is supplied by the usage-status extension.
    const usage = getChatGptUsageBadge(t);
    if (!usage) return;
    return truncateToWidth(usage.styled, width, "");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function isFullscreenTui(tui: any): boolean {
  try {
    return tui?.mode === "fullscreen";
  } catch {
    return false;
  }
}

async function readGitWorkingTreeStats(pi: ExtensionAPI, cwd: string): Promise<GitWorkingTreeStats | null> {
  let result: Awaited<ReturnType<ExtensionAPI["exec"]>>;
  try {
    result = await pi.exec("git", ["-C", cwd, "status", "--porcelain=v1"], { timeout: 3000 });
  } catch {
    return null;
  }
  if (result.code !== 0) return null;

  const stats: GitWorkingTreeStats = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
  };

  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];

    if (x === "?" && y === "?") {
      stats.untracked++;
      continue;
    }

    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      stats.conflicted++;
      continue;
    }

    if (x === "A" || y === "A") stats.added++;
    if (x === "M" || y === "M") stats.modified++;
    if (x === "D" || y === "D") stats.deleted++;
    if (x === "R" || y === "R") stats.renamed++;
  }

  return stats;
}

function formatGitStatsBadge(stats: GitWorkingTreeStats | null) {
  if (!stats) return "";
  const parts: string[] = [];
  if (stats.added) parts.push(`+${stats.added}`);
  if (stats.modified) parts.push(`~${stats.modified}`);
  if (stats.deleted) parts.push(`-${stats.deleted}`);
  if (stats.renamed) parts.push(`»${stats.renamed}`);
  if (stats.untracked) parts.push(`?${stats.untracked}`);
  if (stats.conflicted) parts.push(`!${stats.conflicted}`);
  return parts.length ? parts.join(" ") : "✓";
}

function formatGitStatsStyled(t: any, stats: GitWorkingTreeStats | null) {
  const badge = formatGitStatsBadge(stats);
  if (!badge) return "";
  if (badge === "✓") return t.fg("success", ` ${badge}`);
  return t.fg("dim", " ") + badge.split(" ").map((part) => {
    const color = part.startsWith("!") ? "error"
      : part.startsWith("?") ? "warning"
      : part.startsWith("-") ? "error"
      : part.startsWith("+") ? "success"
      : "accent";
    return t.fg(color, part);
  }).join(t.fg("dim", " "));
}

type ChatGptUsageWindow = {
  label: string;
  used: number;
  remaining: number;
  resetAt?: number;
};

type ChatGptUsageStatus = {
  username?: string;
  fiveHour?: ChatGptUsageWindow;
  weekly?: ChatGptUsageWindow;
  stale?: boolean;
  updatedAt: number;
};

function getChatGptUsageBadge(t: any): { raw: string; styled: string } | undefined {
  const status = (globalThis as any).__piChatGptUsageStatus as ChatGptUsageStatus | undefined;
  if (!status) return;

  const chunks: { raw: string; styled: string }[] = [
    { raw: "ChatGPT", styled: t.fg("accent", "ChatGPT") },
  ];

  const user = compactUsername(status.username, 10);
  if (user) chunks.push({ raw: user, styled: t.fg("muted", user) });
  if (status.fiveHour) chunks.push(formatUsageWindowBadge(t, status.fiveHour, "5h"));
  if (status.weekly) chunks.push(formatUsageWindowBadge(t, status.weekly, "wk"));
  if (status.stale) chunks.push({ raw: "cached", styled: t.fg("warning", "cached") });

  return {
    raw: chunks.map(c => c.raw).join("  ·  "),
    styled: chunks.map(c => c.styled).join(t.fg("dim", "  ·  ")),
  };
}

function formatUsageWindowBadge(t: any, window: ChatGptUsageWindow, fallbackLabel: string) {
  const label = window.label === "weekly" ? "week" : (window.label || fallbackLabel);
  const color = window.remaining <= 5 ? "error" : window.remaining <= 25 ? "warning" : "success";
  const reset = formatCompactReset(window.resetAt);
  const raw = `${label}: ${window.used}% used${reset ? `, reset ${reset}` : ""}`;
  const styled =
    t.fg("muted", `${label}: `) +
    t.fg(color, `${window.used}% used`) +
    (reset ? t.fg("dim", `, reset ${reset}`) : "");
  return { raw, styled };
}

function compactUsername(value: string | undefined, max = 10) {
  if (!value) return;
  const base = value.includes("@") ? value.split("@")[0] : value.trim().split(/\s+/)[0];
  if (!base) return;
  if (base.length <= max) return base;
  return `${base.slice(0, max - 1)}…`;
}

function formatCompactReset(resetAt: number | undefined) {
  if (!resetAt) return;
  const delta = resetAt * 1000 - Date.now();
  if (delta <= 0) return "soon";
  const totalMinutes = Math.max(0, Math.round(delta / 60_000));
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d${restHours}h` : `${days}d`;
}

function getSafeTheme(ctx?: any) {
  try {
    const t = ctx?.ui?.theme;
    if (t && typeof t.fg === "function") return t;
  } catch { /* ctx may be stale during session replacement */ }

  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function showBanner(ctx: any) {
  const t = getSafeTheme(ctx);
  const time = new Date().toLocaleString("vi-VN", {
    weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const w = 44;
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  const lines = [
    t.fg("borderAccent", "╭" + "─".repeat(w) + "╮"),
    t.fg("borderAccent", "│") + "  " + t.fg("accent", t.bold(" ◈  Pi Coding Agent")) + " ".repeat(w - 21) + t.fg("borderAccent", "│"),
    t.fg("borderAccent", "│") + "  " + t.fg("text", pad("  " + time, w - 2)) + t.fg("borderAccent", "│"),
    t.fg("borderAccent", "│") + "  " + t.fg("muted", pad("  midnight-aurora theme", w - 2)) + t.fg("borderAccent", "│"),
    t.fg("borderAccent", "╰" + "─".repeat(w) + "╯"),
  ];
  ctx.ui.setWidget("aurora-banner", lines);
}

function shortModel(id: string): string {
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  if (id.includes("opus")) return "opus";
  if (id.includes("gpt-4o-mini")) return "4o-mini";
  if (id.includes("gpt-4o")) return "4o";
  if (id.includes("gpt-4")) return "gpt4";
  if (id.includes("gemini-2.5-pro")) return "gem-pro";
  if (id.includes("gemini-2.5-flash")) return "gem-flash";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("deepseek")) return "deepseek";
  return id.length > 15 ? id.slice(0, 12) + "…" : id;
}
