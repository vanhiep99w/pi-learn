import { constants, type Stats } from "node:fs";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createWikiAgentInstructions } from "./wiki-prompt.ts";

type Target = { name: string; absolute: string; info: Stats | null; content: string };

// Only these two direct children of the canonical repository root are eligible.
// Stage every change before replacing any target; this is not a multi-file transaction.
export async function ensureWikiAgentBootstrap(cwd: string): Promise<string[]> {
  const root = await realpath(cwd);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) throw new Error("Wiki bootstrap requires a repository directory.");
  const targets = await Promise.all(["AGENTS.md", "CLAUDE.md"].map((name) => readTarget(root, name)));
  const selected = targets.some((target) => target.info) ? targets.filter((target) => target.info) : [targets[0]];
  // Rendering all files first also prevents a malformed second file causing a partial update.
  const changes = selected.map((target) => ({ target, next: updateProjectWikiSection(target.content) }))
    .filter(({ target, next }) => next !== target.content);
  const staged: { target: Target; temporary: string }[] = [];
  try {
    for (const { target, next } of changes) {
      const temporary = path.join(root, `.wiki-bootstrap-${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", target.info ? target.info.mode & 0o777 : 0o666);
      staged.push({ target, temporary });
      try {
        await handle.writeFile(next, "utf8");
        if (target.info) await handle.chmod(target.info.mode & 0o777);
      } finally { await handle.close(); }
    }
    const currentRoot = await lstat(root);
    if (currentRoot.dev !== rootInfo.dev || currentRoot.ino !== rootInfo.ino || !currentRoot.isDirectory()) {
      throw new Error("Repository directory changed during Wiki bootstrap.");
    }
    for (const target of targets) {
      const current = await readTarget(root, target.name);
      if (current.info?.dev !== target.info?.dev || current.info?.ino !== target.info?.ino || current.content !== target.content) {
        throw new Error(`${target.name} changed during Wiki bootstrap; retry initialization.`);
      }
    }
    for (const { target, temporary } of staged) {
      // link() is exclusive for a new file, while rename() atomically replaces an existing
      // directory entry without following a newly substituted target symlink or hard link.
      if (target.info) await rename(temporary, target.absolute);
      else await link(temporary, target.absolute);
    }
    return changes.map(({ target }) => target.name);
  } finally {
    for (const { temporary } of staged) {
      await unlink(temporary).catch((error) => { if (!isMissing(error)) throw error; });
    }
  }
}

async function readTarget(root: string, name: string): Promise<Target> {
  const absolute = path.join(root, name);
  let info: Stats;
  try { info = await lstat(absolute); }
  catch (error) {
    if (isMissing(error)) return { name, absolute, info: null, content: "" };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${name} must be a regular file, not a symlink, for Wiki bootstrap.`);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error(`${name} changed during Wiki bootstrap.`);
    const bytes = await handle.readFile();
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes("\0")) throw new Error(`${name} must contain Markdown text for Wiki bootstrap.`);
    return { name, absolute, info, content };
  } finally { await handle.close(); }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

type Heading = { title: string; level: number; offset: number };

function updateProjectWikiSection(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const bootstrap = createWikiAgentInstructions().replaceAll("\n", eol);
  const headings = bootstrapHeadings(content);
  const sections: { start: number; end: number; level: number }[] = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    if (heading.title !== "Project Wiki" || heading.offset < (sections.at(-1)?.end ?? -1)) continue;
    const next = headings.slice(index + 1).find((item) => item.level <= heading.level);
    sections.push({ start: heading.offset, end: next?.offset ?? content.length, level: heading.level });
  }
  if (!sections.length) {
    const separator = !content || content === "\ufeff" ? "" : content.endsWith(eol + eol) ? "" : content.endsWith(eol) ? eol : eol + eol;
    return content + separator + bootstrap + eol;
  }
  let result = "";
  let cursor = 0;
  for (const [index, section] of sections.entries()) {
    const old = content.slice(section.start, section.end);
    const trailing = /(?:\r?\n[\t ]*)+$/u.exec(old)?.[0] ?? "";
    // Retain the first section's level so sibling headings remain siblings on reruns.
    const replacement = bootstrap.replace(/^## /u, "#".repeat(section.level) + " ");
    result += content.slice(cursor, section.start) + (index === 0 ? replacement : "") + trailing;
    cursor = section.end;
  }
  return result + content.slice(cursor);
}

// ATX and single-line Setext headings, ignoring fenced/indented code and HTML comments.
// Refuse unclosed fences/comments rather than append instructions inside invisible Markdown.
function bootstrapHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let fence: { character: string; length: number } | undefined;
  let comment = false;
  let previous: { text: string; offset: number } | undefined;
  for (const match of content.matchAll(/[^\n]+\n?|\n/gu)) {
    let line = match[0].replace(/\r?\n$/u, "");
    const bom = match.index === 0 && line.startsWith("\ufeff") ? 1 : 0;
    line = line.slice(bom);
    const offset = match.index + bom;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (comment || line.includes("<!--")) {
      const start = comment ? 0 : line.indexOf("<!--") + 4;
      comment = line.indexOf("-->", start) < 0;
      previous = undefined;
      continue;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      previous = undefined;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/u.exec(line);
    const setext = /^ {0,3}(=+|-+)[\t ]*$/u.exec(line);
    if (atx) {
      headings.push({ title: (atx[2] ?? "").replace(/[\t ]+#+[\t ]*$/u, "").trim(), level: atx[1].length, offset });
    } else if (setext && previous) {
      headings.push({ title: previous.text.trim(), level: setext[1][0] === "=" ? 1 : 2, offset: previous.offset });
    }
    previous = !atx && !setext && /^ {0,3}\S/u.test(line) && !/^[ >\t]*[>]/u.test(line) ? { text: line, offset } : undefined;
  }
  if (fence || comment) throw new Error("Unclosed Markdown fence/comment in agent file; cannot safely bootstrap Project Wiki.");
  return headings;
}
