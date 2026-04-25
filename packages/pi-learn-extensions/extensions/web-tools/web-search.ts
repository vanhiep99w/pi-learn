import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  getTavilyKeys,
  isKeyExhausted,
  markKeyExhausted,
  getCached,
  setCache,
  searchCache,
  rateLimit,
  currentYear,
} from "./utils";
import { parseDDGResults, type SearchResult } from "./parsers";

export function registerWebSearch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Search the web and return results with titles, URLs, and snippets. Uses Tavily AI Search when TAVILY_API_KEY is set, otherwise falls back to DuckDuckGo. The current year is ${currentYear()}. Supports batch searching: pass multiple queries via the "queries" array to search them all in parallel and receive combined results in a single response — this saves roundtrips and tokens.`,
    promptSnippet:
      "Use `web_search` to find current information, documentation, tutorials, or answers from the internet. Use the `queries` array for batch/parallel searches.",
    promptGuidelines: [
      "Use specific, well-formed search queries for best results.",
      "When you need to search for multiple things, use the `queries` array to batch them in a single tool call instead of making separate calls — this saves tokens and roundtrips.",
      "Follow up with `web_fetch` to read the full page content of relevant results.",
      "Prefer combining web_search + web_fetch over guessing when unsure.",
      `The current year is ${currentYear()}. Always include the year when searching for recent/current information.`,
      'CRITICAL: After answering, you MUST include a "Sources:" section at the end with all relevant URLs as markdown hyperlinks: [Title](URL). Never skip sources.',
    ],
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "A single search query (use this OR queries, not both)" })
      ),
      queries: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Multiple search queries to execute in parallel. Each query runs concurrently and results are returned together. Max 5 queries per batch.",
        })
      ),
      num_results: Type.Optional(
        Type.Number({
          description: "Number of results per query (default: 10, max: 10)",
        })
      ),
      search_depth: Type.Optional(
        Type.String({
          description:
            'Search depth: "basic" (fast) or "advanced" (thorough, Tavily only). Default: "basic"',
        })
      ),
    }),

    async execute(toolCallId: any, params: any, signal: any, onUpdate: any) {
      const { query, queries, num_results = 10, search_depth = "basic" } = params;
      const maxResults = Math.min(Math.max(1, num_results), 10);

      // ── Input validation ──
      let queryList: string[] = [];
      if (queries && Array.isArray(queries) && queries.length > 0) {
        queryList = queries.slice(0, 5); // max 5 per batch
      } else if (query && query.trim().length >= 2) {
        queryList = [query];
      } else if (query && query.trim().length < 2) {
        return {
          content: [{ type: "text", text: "⚠️ Query too short — provide at least 2 characters." }],
        };
      } else {
        return {
          content: [{ type: "text", text: "⚠️ Provide either `query` (string) or `queries` (array)." }],
        };
      }

      const startTime = performance.now();

      // ── Single query: original fast path ──
      if (queryList.length === 1) {
        const result = await executeSingleSearch(pi, queryList[0], maxResults, search_depth, signal, onUpdate);
        const durationSeconds = (performance.now() - startTime) / 1000;
        if (result?.details) result.details.durationSeconds = durationSeconds;
        return result;
      }

      // ── Batch: parallel execution ──
      onUpdate?.({
        content: [{ type: "text", text: `🔍 Batch search: ${queryList.length} queries in parallel…` }],
      });

      const results = await Promise.all(
        queryList.map((q, i) =>
          executeSingleSearch(pi, q, maxResults, search_depth, signal, (update: any) => {
            onUpdate?.({
              content: [{ type: "text", text: `[${i + 1}/${queryList.length}] ${update?.content?.[0]?.text ?? ""}` }],
            });
          }).catch(() => ({
            content: [{ type: "text", text: `Search failed for "${q}".` }],
            details: { results: [], query: q, engine: "error" },
          }))
        )
      );

      const durationSeconds = (performance.now() - startTime) / 1000;

      // ── Merge results ──
      let combinedOutput = `## Batch Search Results (${queryList.length} queries)\n\n`;
      const allDetails: any[] = [];

      for (let i = 0; i < results.length; i++) {
        const r = results[i] as any;
        combinedOutput += `---\n### Query ${i + 1}: "${queryList[i]}"\n\n`;
        combinedOutput += r?.content?.[0]?.text?.replace(/^## Search Results for .+\n\n/, "") ?? "No results.\n";
        combinedOutput += "\n";
        if (r?.details) allDetails.push(r.details);
      }

      return {
        content: [{ type: "text", text: combinedOutput }],
        details: {
          batch: true,
          queryCount: queryList.length,
          queries: queryList,
          searchResults: allDetails,
          durationSeconds,
        },
      };
    },

    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("🔍 web_search "));
      if (args.queries && args.queries.length > 1) {
        text += theme.fg("dim", `batch ×${args.queries.length}: `);
        text += theme.fg("dim", args.queries.map((q: string) => `"${q}"`).join(", "));
      } else {
        text += theme.fg("dim", `"${args.query || args.queries?.[0] || ""}"`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = result.details as any;

      // ── Batch result ──
      if (details?.batch) {
        let text = theme.fg("success", `✓ ${details.queryCount} queries completed`);
        const totalResults = details.searchResults?.reduce(
          (sum: number, d: any) => sum + (d?.results?.length ?? 0), 0
        ) ?? 0;
        const timeStr = details.durationSeconds >= 1
          ? `${Math.round(details.durationSeconds)}s`
          : `${Math.round((details.durationSeconds ?? 0) * 1000)}ms`;
        text += theme.fg("dim", ` (${totalResults} total results in ${timeStr})`);
        if (expanded && details.searchResults) {
          for (const d of details.searchResults) {
            text += "\n  " + theme.fg("accent", `● "${d.query}"`);
            if (d.results) {
              for (const r of d.results.slice(0, 3)) {
                text += "\n    " + theme.fg("dim", r.title);
              }
            }
          }
        }
        return new Text(text, 0, 0);
      }

      // ── Single result (unchanged) ──
      if (details?.results) {
        const count = details.results.length;
        let label = details.engine === "tavily" ? "Tavily" : "DDG";
        if (details.keyIndex && details.totalKeys > 1) {
          label += ` ${details.keyIndex}/${details.totalKeys}`;
        }
        if (details.cached) label += " ⚡cache";
        const timeStr = details.durationSeconds >= 1
          ? `${Math.round(details.durationSeconds)}s`
          : details.durationSeconds != null
            ? `${Math.round(details.durationSeconds * 1000)}ms`
            : "";
        let text = theme.fg("success", `✓ ${count} results`);
        text += theme.fg("dim", ` (${label}${timeStr ? ` in ${timeStr}` : ""})`);
        if (expanded) {
          if (details.answer) {
            text +=
              "\n  " +
              theme.fg("accent", "AI: " + details.answer.slice(0, 80));
          }
          for (const r of details.results) {
            text += "\n  " + theme.fg("accent", r.title);
            text += "\n  " + theme.fg("dim", r.url);
          }
        }
        return new Text(text, 0, 0);
      }
      return new Text(
        theme.fg("dim", result.content?.[0]?.text || "No results"),
        0,
        0
      );
    },
  });
}

// ── Single search execution (used by both single & batch) ──
async function executeSingleSearch(
  pi: ExtensionAPI,
  query: string,
  maxResults: number,
  searchDepth: string,
  signal: any,
  onUpdate: any,
): Promise<any> {
  const cacheKey = `${query}:${maxResults}:${searchDepth}`;

  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  const tavilyKeys = getTavilyKeys();

  if (tavilyKeys.length > 0) {
    const tavilyResult = await searchTavily(
      pi, tavilyKeys, query, maxResults, searchDepth, signal, onUpdate
    );
    if (tavilyResult) {
      setCache(searchCache, cacheKey, tavilyResult);
      return tavilyResult;
    }
  }

  const ddgResult = await searchDDG(pi, query, maxResults, signal, onUpdate);
  if (ddgResult) setCache(searchCache, cacheKey, ddgResult);
  return ddgResult;
}

// ── Tavily Search with multi-key rotation ──
async function searchTavily(
  pi: ExtensionAPI,
  keys: string[],
  query: string,
  maxResults: number,
  searchDepth: string,
  signal: any,
  onUpdate: any
): Promise<any | null> {
  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki];
    if (isKeyExhausted(key)) continue;

    const keyLabel = keys.length > 1 ? `key ${ki + 1}/${keys.length}` : "";

    onUpdate?.({
      content: [
        { type: "text", text: `🔍 Tavily ${keyLabel}: "${query}"…` },
      ],
    });

    await rateLimit();

    try {
      const body = JSON.stringify({
        api_key: key,
        query,
        search_depth: searchDepth === "advanced" ? "advanced" : "basic",
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      });

      const result = await pi.exec(
        "bash",
        [
          "-c",
          `echo '${body.replace(/'/g, "'\\''")}' | curl -s -m 15 -X POST https://api.tavily.com/search -H 'Content-Type: application/json' -d @-`,
        ],
        { signal, timeout: 20000 }
      );

      if (result.code !== 0) continue;

      let data: any;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        markKeyExhausted(key, false); // temp
        continue;
      }

      const detail =
        typeof data.detail === "string" ? data.detail.toLowerCase() : "";
      if (
        data.error ||
        detail.includes("limit") ||
        detail.includes("quota") ||
        detail.includes("exceeded") ||
        detail.includes("unauthorized") ||
        detail.includes("invalid")
      ) {
        markKeyExhausted(key, true); // permanent
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `⚠️ Key ${ki + 1} exhausted${ki < keys.length - 1 ? ", trying next…" : ""}`,
            },
          ],
        });
        continue;
      }

      if (!data.results || data.results.length === 0) {
        return {
          content: [
            { type: "text", text: `No results found for "${query}".` },
          ],
        };
      }

      let output = `## Search Results for "${query}"\n\n`;
      if (data.answer) {
        output += `**AI Answer:** ${data.answer}\n\n---\n\n`;
      }
      data.results.forEach((r: any, i: number) => {
        output += `### ${i + 1}. ${r.title}\n`;
        output += `**URL:** ${r.url}\n`;
        if (r.content) output += `${r.content}\n`;
        output += "\n";
      });

      const results: SearchResult[] = data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.content || "",
        score: r.score,
      }));

      return {
        content: [{ type: "text", text: output }],
        details: {
          results,
          query,
          engine: "tavily",
          keyIndex: ki + 1,
          totalKeys: keys.length,
          answer: data.answer,
        },
      };
    } catch {
      markKeyExhausted(key, false);
      continue;
    }
  }

  onUpdate?.({
    content: [
      {
        type: "text",
        text: `⚠️ All ${keys.length} Tavily keys exhausted, falling back to DuckDuckGo…`,
      },
    ],
  });

  return null;
}

// ── DuckDuckGo Fallback ──
async function searchDDG(
  pi: ExtensionAPI,
  query: string,
  maxResults: number,
  signal: any,
  onUpdate: any
) {
  onUpdate?.({
    content: [{ type: "text", text: `🔍 DuckDuckGo: "${query}"…` }],
  });

  await rateLimit();

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const result = await pi.exec(
      "curl",
      [
        "-sL",
        "-m",
        "15",
        "-A",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        url,
      ],
      { signal, timeout: 20000 }
    );

    if (result.code !== 0) {
      return {
        content: [{ type: "text", text: `Search failed: ${result.stderr}` }],
      };
    }

    const results = parseDDGResults(result.stdout, maxResults);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No results found for "${query}". Try a different query.`,
          },
        ],
      };
    }

    let output = `## Search Results for "${query}"\n\n`;
    results.forEach((r, i) => {
      output += `### ${i + 1}. ${r.title}\n`;
      output += `**URL:** ${r.url}\n`;
      if (r.snippet) output += `${r.snippet}\n`;
      output += "\n";
    });

    return {
      content: [{ type: "text", text: output }],
      details: { results, query, engine: "duckduckgo" },
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Search error: ${e.message}` }],
    };
  }
}
