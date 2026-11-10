// One heading/anchor dialect for Wiki links and section retrieval (ATX headings only).
export function wikiHeadings(content) {
  const lines = content.split("\n");
  const headings = [];
  const used = new Set();
  const nextSuffix = new Map();
  let offset = 0;
  let fence;
  let frontmatterEnd = -1;
  if (lines[0]?.replace(/^\ufeff/u, "").trim() === "---") {
    frontmatterEnd = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  }
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    let line = raw.replace(/\r$/u, "");
    if (index === 0) line = line.replace(/^\ufeff/u, "");
    const start = offset;
    offset += raw.length + 1;
    if (index <= frontmatterEnd) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    const match = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const title = match[2].replace(/[\t ]+#+[\t ]*$/u, "").trim();
    const base = slugifyWikiHeading(title);
    if (!base) continue;
    let anchor = base;
    let suffix = nextSuffix.get(base) ?? 1;
    while (used.has(anchor)) anchor = `${base}-${suffix++}`;
    nextSuffix.set(base, suffix);
    used.add(anchor);
    headings.push({ title, level: match[1].length, anchor, line: index + 1, offset: start });
  }
  return headings;
}

export function slugifyWikiHeading(value) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");
}
