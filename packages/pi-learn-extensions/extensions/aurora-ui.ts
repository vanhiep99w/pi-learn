import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

// ═══════════════════════════════════════════════════════════════════════════════
//  Aurora UI Extension — Bordered Input + Custom Footer
//  • Startup banner (tự ẩn sau 5s)
//  • Bordered editor: rounded border bao quanh ô input
//    - Top border: context usage (left) + model/thinking/session (right)
//    - Bottom border: cwd + git branch
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

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SESSION START                                               ║
  // ╚══════════════════════════════════════════════════════════════╝
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // ── Startup Banner ──────────────────────────────────────────
    showBanner(ctx);
    setTimeout(() => ctx.ui.setWidget("aurora-banner", undefined), 5000);

    // ── Bordered Editor ─────────────────────────────────────────
    // CustomEditor constructor: (tui, theme, keybindings, options?)
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      installStickyBottomViewport(tui);
      return new BorderedEditor(tui, theme, keybindings, pi, ctx, () => gitBranch, () => gitStats);
    });

    let requestRender = () => {};
    const refreshGitStats = async () => {
      if (refreshingGitStats) return;
      refreshingGitStats = true;
      try {
        gitStats = await readGitWorkingTreeStats(pi, ctx.cwd);
        requestRender();
      } finally {
        refreshingGitStats = false;
      }
    };

    void refreshGitStats();
    const gitStatsTimer = setInterval(refreshGitStats, 2500);

    // ── Minimal Footer (chỉ extension statuses) ────────────────
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const branchDispose = footerData.onBranchChange(() => {
        gitBranch = footerData.getGitBranch();
        void refreshGitStats();
        tui.requestRender();
      });

      return {
        dispose: () => {
          clearInterval(gitStatsTimer);
          branchDispose();
        },
        invalidate() {},
        render(_w: number): string[] {
          // Cập nhật git branch mỗi lần render
          gitBranch = footerData.getGitBranch();

          // Chỉ hiển thị extension statuses (từ aurora-teams, etc.)
          const parts: string[] = [];
          for (const [, v] of footerData.getExtensionStatuses()) parts.push(v);
          return parts.length > 0 ? [parts.join("  ")] : [];
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
//  BorderedEditor — Input box với rounded border
//
//  Layout:
//  ╭─ 7% of 300k ──────────────────── sonnet─◑ medium─my-session ─╮
//  │ > type your prompt here_                                       │
//  ╰───────────────────────────────── ~/Desktop/project (main) ─────╯
// ═══════════════════════════════════════════════════════════════════════════════

class BorderedEditor extends CustomEditor {
  private piRef: ExtensionAPI;
  private ctxRef: any;
  private getBranch: () => string | null;
  private getGitStats: () => GitWorkingTreeStats | null;

  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    pi: ExtensionAPI,
    ctx: any,
    getBranch: () => string | null,
    getGitStats: () => GitWorkingTreeStats | null,
  ) {
    // CustomEditor constructor: (tui, theme, keybindings, options?)
    super(tui, theme, keybindings);
    this.piRef = pi;
    this.ctxRef = ctx;
    this.getBranch = getBranch;
    this.getGitStats = getGitStats;
  }

  render(width: number): string[] {
    const t = this.ctxRef.ui.theme;
    // Inner width = width - 4 (for "│ " on left + " │" on right)
    const inner = Math.max(1, width - 4);

    // Get editor content with reduced width
    const allLines = super.render(inner);

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

    // ── Top border with badges ──
    result.push(this.topBorder(width, t));

    // ── Content lines with side borders ──
    // Keep the prompt box readable even when the editor has only one line.
    const minContentRows = 3;
    const visibleContentLines = [...contentLines];
    while (visibleContentLines.length < minContentRows) visibleContentLines.push("");

    for (const line of visibleContentLines) {
      const vw = visibleWidth(line);
      const pad = " ".repeat(Math.max(0, inner - vw));
      result.push(
        t.fg("borderAccent", "│") + " " + line + pad + " " + t.fg("borderAccent", "│")
      );
    }

    // ── Bottom border with cwd ──
    result.push(this.bottomBorder(width, t));

    // ── Autocomplete dropdown (rendered after bottom border) ──
    for (const line of autocompleteLines) {
      result.push(line);
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  //  Top border: ╭─ context ──────── model─thinking─session ─╮
  // ─────────────────────────────────────────────────────────────
  private topBorder(w: number, t: any): string {
    const bc = "borderAccent";

    // Fallback for very narrow terminals
    if (w < 20) return t.fg(bc, "╭" + "─".repeat(Math.max(0, w - 2)) + "╮");

    // ── Left badges: context usage ─ cwd/branch ──
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

    const cwd = this.ctxRef.cwd.replace(/\/home\/[^/]+/, "~");
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

    const m = this.ctxRef.model;
    if (m) {
      const name = shortModel(m.id);
      rParts.push({ raw: name, styled: t.fg("accent", name) });
    }

    const lv = this.piRef.getThinkingLevel();
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

    const sessionName = this.ctxRef.sessionManager?.getSessionName?.();
    if (sessionName) {
      rParts.push({ raw: sessionName, styled: t.fg("accent", sessionName) });
    }

    // Join badges with ─ separators (embedded in border)
    const rRaw = rParts.map(p => p.raw).join("─");
    const rStyled = rParts.map(p => p.styled).join(t.fg(bc, "─"));
    let lRaw = lParts.map(p => p.raw).join(" ─ ");
    let lStyled = lParts.map(p => p.styled).join(t.fg(bc, " ─ "));
    let lW = lRaw.length;
    const rW = rRaw.length;

    // If the terminal is too narrow, keep context usage and drop cwd first.
    if (rW > 0 && lW + rW + 8 > w && lParts.length > 1) {
      lRaw = lParts[0].raw;
      lStyled = lParts[0].styled;
      lW = lRaw.length;
    }

    // Layout: ╭─ left ───...─── right ─╮
    // Width:  3 + lW + 1 + filler + 1 + rW + 3 = w
    if (lW > 0 && rW > 0) {
      const fill = Math.max(1, w - 8 - lW - rW);
      return (
        t.fg(bc, "╭─ ") + lStyled + " " +
        t.fg(bc, "─".repeat(fill)) + " " +
        rStyled + t.fg(bc, " ─╮")
      );
    }
    if (lW > 0) {
      const fill = Math.max(1, w - 5 - lW);
      return t.fg(bc, "╭─ ") + lStyled + t.fg(bc, " " + "─".repeat(fill) + "╮");
    }
    if (rW > 0) {
      const fill = Math.max(1, w - 5 - rW);
      return t.fg(bc, "╭" + "─".repeat(fill) + " ") + rStyled + t.fg(bc, " ─╮");
    }
    return t.fg(bc, "╭" + "─".repeat(w - 2) + "╮");
  }

  // ─────────────────────────────────────────────────────────────
  //  Bottom border: ╰─ ChatGPT usage ───────────────────────────╯
  // ─────────────────────────────────────────────────────────────
  private bottomBorder(w: number, t: any): string {
    const bc = "borderAccent";

    if (w < 20) return t.fg(bc, "╰" + "─".repeat(Math.max(0, w - 2)) + "╯");

    // ChatGPT subscription usage is supplied by .pi/extensions/chatgpt-usage-status.
    // Put it on the lower-left corner. If usage is not available, draw a clean border.
    const usage = getChatGptUsageBadge(t);
    if (!usage || usage.raw.length + 6 > w) {
      return t.fg(bc, "╰" + "─".repeat(w - 2) + "╯");
    }

    // Layout: ╰─ usage ───...───╯
    // Width:  3 + usage + 1 + filler + 1 = w
    const fill = Math.max(1, w - 5 - usage.raw.length);
    return (
      t.fg(bc, "╰─ ") +
      usage.styled +
      t.fg(bc, " " + "─".repeat(fill) + "╯")
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Sticky bottom viewport
// ═══════════════════════════════════════════════════════════════════════════════

const STICKY_BOTTOM_PATCH = Symbol.for("pi-learn.aurora-ui.sticky-bottom-patch");

function installStickyBottomViewport(tui: any) {
  if (!tui || tui[STICKY_BOTTOM_PATCH]) return;

  const originalRender = tui.render?.bind(tui);
  if (typeof originalRender !== "function") return;

  tui.render = (width: number) => {
    const lines = originalRender(width) as string[];
    const rows = tui.terminal?.rows;

    // Pi's TUI renders components sequentially. When the rendered content is
    // shorter than the terminal height, the editor naturally appears above the
    // physical bottom and leaves blank rows below it. Pad the top of the render
    // buffer instead, so the prompt/editor stays glued to the bottom edge.
    if (!Number.isFinite(rows) || rows <= 0 || lines.length >= rows) return lines;

    return [...Array(rows - lines.length).fill(""), ...lines];
  };

  tui[STICKY_BOTTOM_PATCH] = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

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

function showBanner(ctx: any) {
  const t = ctx.ui.theme;
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
