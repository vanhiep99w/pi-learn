/** Compact session tree with native Pi navigation; /tree itself remains unchanged. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionTreeView, type TreeTarget } from "./tree-view.ts";
import { sampleEvents, sessionEvents } from "./tree-events.ts";

export default function registerSessionTree(pi: ExtensionAPI, options: { command?: string } = {}) {
  const command = options.command ?? "tree-v2";
  pi.registerCommand(command, {
    description: "Cây phiên gọn: Enter chuyển vị trí như /tree, Space/click bung chi tiết",
    handler: async (args, ctx) => {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        const message = `/${command} cần Pi TUI. Mở Pi rồi chạy /${command}.`;
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const mode = args.trim();
      if (mode && mode !== "sample") {
        ctx.ui.notify(`/${command} xem phiên thật; /${command} sample xem dữ liệu mẫu.`, "warning");
        return;
      }
      const sample = mode === "sample";
      let selectedId: string | undefined;
      while (true) {
        // Snapshot in memory only. Sample entries must never reach navigateTree().
        const fixture = sample ? sampleEvents() : undefined;
        const snapshot = fixture
          ? sessionEvents(fixture.entries, fixture.leafId)
          : sessionEvents(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
        const target = await ctx.ui.custom<TreeTarget | undefined>((tui, theme, keybindings, done) => new SessionTreeView(
          snapshot.nodes, theme, keybindings,
          () => Math.max(1, tui.terminal.rows - 2),
          () => tui.requestRender(),
          () => done(undefined),
          { currentId: snapshot.currentId, live: !sample, selectedId, onNavigate: sample ? undefined : done, getTheme: () => ctx.ui.theme },
        ), {
          overlay: true,
          overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 1 },
        });
        if (!target || sample) return;
        selectedId = target.nodeId;
        if (target.entryId === ctx.sessionManager.getLeafId()) {
          ctx.ui.notify("Đang ở vị trí này.", "info");
          return;
        }
        // Match native /tree's explicit summary choices; no private settings access.
        let summarize = false, customInstructions: string | undefined, cancelled = false;
        while (true) {
          const choice = await ctx.ui.select("Tóm tắt nhánh đang rời?", [
            "Không tóm tắt", "Tóm tắt", "Tóm tắt với hướng dẫn riêng",
          ]);
          if (choice === undefined) { cancelled = true; break; }
          summarize = choice !== "Không tóm tắt";
          if (choice === "Tóm tắt với hướng dẫn riêng") {
            customInstructions = await ctx.ui.editor("Hướng dẫn tóm tắt nhánh");
            if (customInstructions === undefined) continue;
          }
          break;
        }
        if (cancelled) continue; // Escape returns to the tree, without moving the branch.
        try {
          // Native /tree also stops a running response only after navigation is confirmed.
          if (!ctx.isIdle()) { ctx.abort(); await ctx.waitForIdle(); }
          const result = await ctx.navigateTree(target.entryId, { summarize, customInstructions });
          if (result.cancelled) ctx.ui.notify("Đã hủy chuyển vị trí.", "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
    },
  });
}
