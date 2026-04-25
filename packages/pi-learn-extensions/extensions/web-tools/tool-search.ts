import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerToolSearch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "tool_search",
    label: "Tool Search",
    description:
      "Search for available tools, slash commands, and capabilities in the current Pi session. Use this to discover what tools are available.",
    promptSnippet:
      "Use `tool_search` to list or search for available tools and commands.",
    promptGuidelines: [
      "Use when you need to discover what tools are available.",
      "Leave query empty to list all tools and commands.",
      "Tool names match the function names you can call.",
    ],
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: "Search keyword (leave empty to list all)",
        })
      ),
    }),

    async execute(toolCallId: any, params: any, signal: any, onUpdate: any) {
      const query = (params.query || "").toLowerCase();

      const allTools = pi.getAllTools();
      const activeTools = new Set(pi.getActiveTools());
      const commands = pi.getCommands();

      const toolResults = allTools
        .filter((name: string) => !query || name.toLowerCase().includes(query))
        .map((name: string) => {
          const status = activeTools.has(name) ? "✓ active" : "○ deferred";
          return `- **${name}** ${status}`;
        });

      const cmdResults = commands
        .filter(
          (c: any) =>
            !query ||
            c.name.toLowerCase().includes(query) ||
            (c.description || "").toLowerCase().includes(query)
        )
        .map(
          (c: any) =>
            `- **/${c.name}** — ${c.description || "No description"} _(${c.source || "built-in"})_`
        );

      let output = "";
      if (toolResults.length > 0) {
        output += `## Tools (${toolResults.length})\n${toolResults.join("\n")}\n\n`;
      }
      if (cmdResults.length > 0) {
        output += `## Slash Commands (${cmdResults.length})\n${cmdResults.join("\n")}\n\n`;
      }

      if (!output) {
        output = query
          ? `No tools or commands found matching "${query}".`
          : "No tools or commands available.";
      }

      return {
        content: [{ type: "text", text: output }],
        details: { tools: toolResults.length, commands: cmdResults.length },
      };
    },

    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("🔧 tool_search "));
      if (args.query) text += theme.fg("dim", `"${args.query}"`);
      else text += theme.fg("dim", "(list all)");
      return new Text(text, 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const d = result.details as any;
      if (d) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("dim", `${d.tools} tools, ${d.commands} commands`),
          0,
          0
        );
      }
      return new Text(theme.fg("dim", "Done"), 0, 0);
    },
  });
}
