/**
 * Pi Mermaid ASCII Render Extension
 * Dùng beautiful-mermaid để render ASCII trong terminal.
 *
 * Install: npm install -g beautiful-mermaid
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";

// Resolve beautiful-mermaid từ global node_modules
const _require = createRequire(import.meta.url);
function loadBeautifulMermaid() {
  // Thử local trước, sau đó global
  const paths = [
    "beautiful-mermaid",
    `${process.execPath.replace(/\/bin\/node$/, "")}/lib/node_modules/beautiful-mermaid`,
  ];
  for (const p of paths) {
    try { return _require(p); } catch {}
  }
  throw new Error("beautiful-mermaid not found. Run: npm install -g beautiful-mermaid");
}

// ─── Mermaid Live URL ─────────────────────────────────────

function toMermaidLiveUrl(code: string): string {
  const state = JSON.stringify({ code, mermaid: { theme: "default" }, updateEditor: false, autoSync: true, updateDiagram: true });
  const compressed = deflateSync(Buffer.from(state, "utf8"), { level: 9 });
  const b64 = compressed.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `https://mermaid.live/edit#pako:${b64}`;
}

function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// ─── Renderer ─────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderMermaidASCII(code: string): string {
  const { renderMermaidASCII: render } = loadBeautifulMermaid();
  return stripAnsi(render(code));
}

function diagramSummary(code: string): string {
  const typeMap: Record<string, string> = {
    flowchart: "Flowchart", graph: "Graph",
    sequencediagram: "Sequence Diagram", classdiagram: "Class Diagram",
    erdiagram: "ER Diagram", gantt: "Gantt Chart", pie: "Pie Chart",
    statediagram: "State Diagram", gitgraph: "Git Graph",
    mindmap: "Mindmap", timeline: "Timeline",
  };
  const first = code.trim().split("\n")[0].trim().toLowerCase();
  let type = "Diagram";
  for (const [k, v] of Object.entries(typeMap)) {
    if (first.startsWith(k)) { type = v; break; }
  }
  return `${type} · ${code.trim().split("\n").length} lines`;
}

// ─── Extension ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "mermaid_render",
    label: "Mermaid Render",
    description:
      "Vẽ và hiển thị Mermaid diagram dưới dạng ASCII art trực tiếp trong terminal. " +
      "Các loại ĐƯỢC hỗ trợ: flowchart, graph, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, xychart-beta. " +
      "Các loại chỉ hỗ trợ web view (click link mermaid.live): pie, gantt, gitGraph, mindmap, timeline, quadrantChart.",

    parameters: Type.Object({
      diagram: Type.String({ description: "Mermaid diagram code đầy đủ" }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate) {
      const summary = diagramSummary(params.diagram);
      onUpdate?.({
        content: [{ type: "text", text: `Rendering ${summary}...` }],
        details: { status: "rendering" },
      });

      const liveUrl = toMermaidLiveUrl(params.diagram);
      try {
        const rendered = renderMermaidASCII(params.diagram);
        return {
          content: [{ type: "text", text: rendered }],
          details: { rendered, summary, liveUrl, status: "ok" },
        };
      } catch {
        // Không support → fallback mermaid.live
        return {
          content: [{ type: "text", text: `Diagram type not supported for ASCII render. View at: ${liveUrl}` }],
          details: { summary, liveUrl, status: "fallback" },
        };
      }
    },

    renderCall(args, theme, context) {
      const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const summary = diagramSummary((args.diagram as string) ?? "");
      text.setText(
        theme.fg("toolTitle", theme.bold("mermaid_render ")) +
        theme.fg("muted", summary)
      );
      return text;
    },

    renderResult(result, { expanded }, theme, context) {
      const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const details = result.details as any;

      const link = details?.liveUrl
        ? "  " + hyperlink(details.liveUrl, theme.fg("dim", "↗ mermaid.live"))
        : "";

      let out: string;
      if (details?.status === "fallback") {
        out = theme.fg("warning", "⚠ ") + theme.fg("toolTitle", details?.summary ?? "Diagram") +
          theme.fg("dim", " (chỉ hỗ trợ web view) ") + link;
      } else {
        out = theme.fg("success", "✓ ") + theme.fg("toolTitle", details?.summary ?? "Diagram") + link;
        if (details?.rendered) out += "\n" + details.rendered;
      }
      text.setText(out);
      return text;
    },
  });

  pi.registerCommand("mermaid", {
    description: "Render Mermaid diagram as ASCII. Usage: /mermaid <code>",
    handler: async (args, ctx) => {
      const code = args?.trim();
      if (!code) {
        ctx.ui.notify("Usage: /mermaid <diagram code>", "warning");
        return;
      }
      try {
        const rendered = renderMermaidASCII(code);
        ctx.ui.notify(`✓ ${diagramSummary(code)}`, "info");
      } catch (e: any) {
        ctx.ui.notify(`✗ ${e.message}`, "error");
      }
    },
  });
}
