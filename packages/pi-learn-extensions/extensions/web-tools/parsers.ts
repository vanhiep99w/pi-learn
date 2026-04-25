// ═══════════════════════════════════════════════════════════════
//  HTML → Markdown Converter
// ═══════════════════════════════════════════════════════════════

export function htmlToMarkdown(html: string): string {
  let text = html;

  // Remove non-content elements
  text = text.replace(
    /<(script|style|nav|footer|header|aside|noscript|svg|iframe|form)[^>]*>[\s\S]*?<\/\1>/gi,
    ""
  );
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Extract <title>
  const titleMatch = text.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : "";

  // Try to extract <main>, <article>, or role="main" for better content
  const mainMatch =
    text.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i) ||
    text.match(/role="main"[^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (mainMatch) {
    text = mainMatch[2] || mainMatch[1];
  }

  // Headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Code blocks — preserve language hint
  text = text.replace(
    /<pre[^>]*><code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    "\n```$1\n$2\n```\n"
  );
  text = text.replace(
    /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    "\n```\n$1\n```\n"
  );
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");

  // Links
  text = text.replace(
    /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    "[$2]($1)"
  );

  // Bold / Italic
  text = text.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // Lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  text = text.replace(/<\/?[uo]l[^>]*>/gi, "\n");

  // Tables — basic conversion
  text = text.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, "| **$1** ");
  text = text.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, "| $1 ");
  text = text.replace(/<\/tr>/gi, "|\n");
  text = text.replace(/<tr[^>]*>/gi, "");
  text = text.replace(/<\/?t(head|body|foot|able)[^>]*>/gi, "\n");

  // Paragraphs and breaks
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Blockquotes
  text = text.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, content) => {
      return (
        content
          .split("\n")
          .map((l: string) => `> ${l}`)
          .join("\n") + "\n"
      );
    }
  );

  // Images — extract alt and src
  text = text.replace(
    /<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi,
    "![$1]($2)"
  );
  text = text.replace(
    /<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi,
    "![$2]($1)"
  );
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "[$1]");
  text = text.replace(/<img[^>]*>/gi, "");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities
  text = decodeEntities(text);

  // Clean whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  // Prepend title
  if (title && !text.startsWith("# ")) {
    text = `# ${title}\n\n${text}`;
  }

  return text;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

// ═══════════════════════════════════════════════════════════════
//  DuckDuckGo Results Parser
// ═══════════════════════════════════════════════════════════════

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export function parseDDGResults(
  html: string,
  maxResults: number
): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    const titleMatch = block.match(
      /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!titleMatch) continue;

    let url = titleMatch[1];
    const title = decodeEntities(
      titleMatch[2].replace(/<[^>]+>/g, "").trim()
    );

    // Extract actual URL from DDG redirect
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    if (url.includes("duckduckgo.com")) continue;

    // Extract snippet
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)/
    );
    const snippet = snippetMatch
      ? decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, "").trim())
      : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}
