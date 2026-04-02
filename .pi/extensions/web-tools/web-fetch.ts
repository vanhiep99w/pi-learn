import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  normalizeUrl,
  validateUrl,
  isPermittedRedirect,
  isBinaryContent,
  getCached,
  setCache,
  fetchCache,
  rateLimit,
  formatChars,
} from "./utils";
import { htmlToMarkdown } from "./parsers";

export function registerWebFetch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch content from a URL and convert HTML to readable markdown. Supports GitHub blob→raw URL conversion, HTTP→HTTPS upgrade, Cloudflare bypass, and PDF detection.",
    promptSnippet:
      "Use `web_fetch` to read the full content of a web page URL.",
    promptGuidelines: [
      "Use after web_search to read full page content from relevant URLs.",
      "For GitHub repository URLs, navigate to the specific file and fetch the raw URL (raw.githubusercontent.com).",
      "For direct file URLs (raw.githubusercontent.com, gitlab.com/-/raw/), fetch directly.",
      "For JSON API endpoints, the raw JSON response will be returned.",
      "Content is automatically truncated to max_length characters.",
      "Use `start_index` to read the next chunk of a truncated page.",
      "GitHub blob URLs are automatically converted to raw URLs for direct content.",
      "HTTP URLs are automatically upgraded to HTTPS.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      max_length: Type.Optional(
        Type.Number({
          description: "Max characters to return (default: 10000)",
        })
      ),
      start_index: Type.Optional(
        Type.Number({
          description:
            "Start reading from this character index (for paginated reading of long pages, default: 0)",
        })
      ),
      raw: Type.Optional(
        Type.Boolean({
          description:
            "Return raw HTML/content without markdown conversion (default: false)",
        })
      ),
    }),

    async execute(toolCallId: any, params: any, signal: any, onUpdate: any) {
      let { url, max_length = 10000, start_index = 0, raw = false } = params;

      // ── URL Validation ──
      const validation = validateUrl(url);
      if (!validation.valid) {
        return {
          content: [{ type: "text", text: `⚠️ ${validation.error}` }],
        };
      }

      const startTime = performance.now();

      // Normalize: HTTP→HTTPS, GitHub blob→raw
      const originalUrl = url;
      url = normalizeUrl(url);
      const wasNormalized = url !== originalUrl;

      // Check cache for full content
      const cacheKey = `${url}:${raw}`;
      let fullContent = getCached<string>(fetchCache, cacheKey);

      if (!fullContent) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `🌐 Fetching: ${url}${wasNormalized ? " (normalized)" : ""}…`,
            },
          ],
        });

        await rateLimit();

        try {
          // First attempt — no auto-redirect, handle manually
          let result = await pi.exec(
            "curl",
            [
              "-s",
              "-m",
              "20",
              "--max-filesize",
              "5242880",
              "-w",
              "\n%{http_code}\n%{redirect_url}",
              "-A",
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              "-H",
              "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "-H",
              "Accept-Language: en-US,en;q=0.9",
              url,
            ],
            { signal, timeout: 25000 }
          );

          if (result.code !== 0) {
            return {
              content: [
                { type: "text", text: `Fetch failed: ${result.stderr}` },
              ],
            };
          }

          // Extract HTTP status code and redirect URL from -w output
          let body = result.stdout;
          let lines = body.split("\n");
          const redirectUrl = lines.pop()?.trim() || "";
          const statusCode = lines.pop()?.trim() || "";
          body = lines.join("\n");

          // ── Smart Redirect Handling ──
          if (["301", "302", "307", "308"].includes(statusCode) && redirectUrl) {
            if (isPermittedRedirect(url, redirectUrl)) {
              // Same-host redirect → follow automatically
              onUpdate?.({
                content: [{ type: "text", text: `🔄 Following redirect → ${redirectUrl}` }],
              });
              result = await pi.exec(
                "curl",
                [
                  "-sL",
                  "-m",
                  "20",
                  "--max-filesize",
                  "5242880",
                  "-w",
                  "\n%{http_code}\n%{url_effective}",
                  "-A",
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                  "-H",
                  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  redirectUrl,
                ],
                { signal, timeout: 25000 }
              );
              if (result.code !== 0) {
                return {
                  content: [{ type: "text", text: `Redirect fetch failed: ${result.stderr}` }],
                };
              }
              body = result.stdout;
              lines = body.split("\n");
              lines.pop(); // url_effective
              lines.pop(); // http_code
              body = lines.join("\n");
            } else {
              // Cross-host redirect → inform agent, don't follow
              const statusText = statusCode === "301" ? "Moved Permanently"
                : statusCode === "308" ? "Permanent Redirect"
                : statusCode === "307" ? "Temporary Redirect"
                : "Found";
              const durationMs = Math.round(performance.now() - startTime);
              return {
                content: [{
                  type: "text",
                  text: `REDIRECT DETECTED: The URL redirects to a different host.\n\nOriginal URL: ${url}\nRedirect URL: ${redirectUrl}\nStatus: ${statusCode} ${statusText}\n\nTo fetch the redirected content, call web_fetch again with url: "${redirectUrl}"`,
                }],
                details: {
                  url,
                  redirectUrl,
                  statusCode: Number(statusCode),
                  crossHost: true,
                  durationMs,
                },
              };
            }
          } else {
            // Not a redirect — follow any remaining redirects with -L for the body
            if (statusCode === "200") {
              // Already have the body, no need to re-fetch
            } else {
              // Re-fetch with -L for other status codes
              result = await pi.exec(
                "curl",
                [
                  "-sL",
                  "-m",
                  "20",
                  "--max-filesize",
                  "5242880",
                  "-w",
                  "\n%{http_code}\n%{url_effective}",
                  "-A",
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                  "-H",
                  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  url,
                ],
                { signal, timeout: 25000 }
              );
              if (result.code === 0) {
                body = result.stdout;
                lines = body.split("\n");
                lines.pop(); // url_effective
                const newStatus = lines.pop()?.trim() || "";
                body = lines.join("\n");

                // Cloudflare bypass: retry with honest UA on 403
                if (newStatus === "403") {
                  onUpdate?.({
                    content: [{ type: "text", text: `🔄 Retrying (Cloudflare)…` }],
                  });
                  result = await pi.exec(
                    "curl",
                    [
                      "-sL",
                      "-m",
                      "20",
                      "--max-filesize",
                      "5242880",
                      "-A",
                      "opencode-pi/1.0",
                      "-H",
                      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                      url,
                    ],
                    { signal, timeout: 25000 }
                  );
                  if (result.code === 0) {
                    body = result.stdout;
                  }
                }
              }
            }
          }

          // Cloudflare bypass for initial 403 (non-redirect case)
          if (statusCode === "403") {
            onUpdate?.({
              content: [{ type: "text", text: `🔄 Retrying (Cloudflare)…` }],
            });
            result = await pi.exec(
              "curl",
              [
                "-sL",
                "-m",
                "20",
                "--max-filesize",
                "5242880",
                "-A",
                "opencode-pi/1.0",
                "-H",
                "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                url,
              ],
              { signal, timeout: 25000 }
            );
            if (result.code === 0) {
              body = result.stdout;
            }
          }

          // Detect binary/PDF content
          if (isBinaryContent(body)) {
            if (body.trimStart().startsWith("%PDF")) {
              const pdfResult = await pi.exec(
                "bash",
                [
                  "-c",
                  `echo '${url}' | xargs curl -sL -m 20 | pdftotext -layout - - 2>/dev/null || echo '[PDF content - pdftotext not available. Install poppler-utils to extract PDF text.]'`,
                ],
                { signal, timeout: 30000 }
              );
              body =
                pdfResult.code === 0
                  ? pdfResult.stdout
                  : "[Binary/PDF content cannot be displayed as text.]";
            } else {
              return {
                content: [
                  {
                    type: "text",
                    text: "[Binary content detected. This URL returns non-text content.]",
                  },
                ],
              };
            }
          }

          // Convert HTML → Markdown
          const trimmed = body.trimStart();
          const isJSON = trimmed.startsWith("{") || trimmed.startsWith("[");

          if (!raw && !isJSON) {
            fullContent = htmlToMarkdown(body);
          } else {
            fullContent = body;
          }

          // Cache the full content
          setCache(fetchCache, cacheKey, fullContent);
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `Fetch error: ${e.message}` }],
          };
        }
      } else {
        // Cache hit
        onUpdate?.({
          content: [{ type: "text", text: `⚡ Cache hit: ${url}` }],
        });
      }

      const durationMs = Math.round(performance.now() - startTime);

      // ── Paginated output ──
      const totalLength = fullContent.length;

      if (start_index >= totalLength) {
        return {
          content: [
            {
              type: "text",
              text: `start_index (${start_index}) exceeds content length (${totalLength}).`,
            },
          ],
        };
      }

      let content = fullContent.slice(start_index, start_index + max_length);
      const truncated = start_index + max_length < totalLength;
      const remaining = totalLength - (start_index + max_length);

      if (truncated) {
        content += `\n\n---\n[Showing ${formatChars(content.length)} from index ${start_index}. ${formatChars(remaining)} remaining. Use start_index=${start_index + max_length} to continue.]`;
      }

      return {
        content: [{ type: "text", text: content }],
        details: {
          url,
          totalLength,
          showing: content.length,
          start_index,
          truncated,
          remaining: truncated ? remaining : 0,
          cached: getCached(fetchCache, cacheKey) !== null,
          durationMs,
        },
      };
    },

    renderCall(args: any, theme: any) {
      const fullUrl = args.url;
      const shortUrl =
        fullUrl.length > 60 ? fullUrl.slice(0, 57) + "…" : fullUrl;
      // OSC 8 hyperlink: display shortUrl but href = fullUrl
      const link = `\x1b]8;;${fullUrl}\x1b\\${shortUrl}\x1b]8;;\x1b\\`;
      let text = theme.fg("toolTitle", theme.bold("🌐 web_fetch "));
      text += theme.fg("dim", link);
      if (args.start_index) {
        text += theme.fg("dim", ` @${args.start_index}`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const d = result.details as any;

      // Cross-host redirect
      if (d?.crossHost) {
        let text = theme.fg("warning", `↗ Redirect to different host`);
        text += theme.fg("dim", ` → ${d.redirectUrl}`);
        if (d.durationMs) text += theme.fg("dim", ` (${d.durationMs}ms)`);
        return new Text(text, 0, 0);
      }

      // Compact summary line
      let summaryText = "";
      if (d) {
        const timeStr = d.durationMs >= 1000
          ? `${(d.durationMs / 1000).toFixed(1)}s`
          : `${d.durationMs}ms`;
        summaryText += theme.fg("success", "✓ Fetched ");
        summaryText += theme.fg("dim", `(${formatChars(d.showing)} in ${timeStr})`);
        if (d.truncated) {
          summaryText += theme.fg("warning", ` [${formatChars(d.remaining)} more]`);
        }
        if (d.cached) summaryText += theme.fg("dim", " ⚡cached");
      } else {
        summaryText = theme.fg("dim", "Fetched");
      }

      if (!expanded) {
        return new Text(summaryText, 0, 0);
      }

      // Expanded: show actual content
      const rawContent: string =
        result?.content?.[0]?.text ?? "(no content)";
      const preview =
        rawContent.length > 3000
          ? rawContent.slice(0, 3000) + `\n… [${formatChars(rawContent.length - 3000)} more]`
          : rawContent;

      const lines = [summaryText, "", preview];
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
