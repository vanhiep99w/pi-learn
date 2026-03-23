import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWebSearch } from "./web-search";
import { registerWebFetch } from "./web-fetch";
import { registerToolSearch } from "./tool-search";

import { getTavilyKeys } from "./utils";

export default function (pi: ExtensionAPI) {
  registerWebSearch(pi);
  registerWebFetch(pi);
  registerToolSearch(pi);


  // Startup notification
  pi.on("session_start", () => {
    const keys = getTavilyKeys();
    const engine = keys.length > 0 ? `Tavily ×${keys.length}` : "DuckDuckGo";
    pi.ctx?.ui?.notify(
      `🌐 Web Tools v2 (${engine}): web_search, web_fetch, tool_search`,
      2000
    );
  });
}
