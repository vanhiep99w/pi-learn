import fs from "node:fs";
import path from "node:path";
import { isWikiDocumentationPath } from "./wiki-prompt-rules.js";

const MARKDOWN_LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/gu;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;

/**
 * Validate relative Markdown links between files under the Harness Wiki root.
 * External links and images are intentionally ignored.
 */
export function validateWikiInternalLinks({ projectRoot, wikiDir = "wiki" }) {
  const normalizedWikiDir = normalizeRepositoryPath(wikiDir);
  const wikiRoot = path.resolve(projectRoot, normalizedWikiDir);
  const report = {
    filesScanned: 0,
    linksChecked: 0,
    issues: [],
  };

  if (!fs.existsSync(wikiRoot)) return report;
  if (fs.lstatSync(wikiRoot).isSymbolicLink()) {
    throw new Error(`${normalizedWikiDir}/ must not be a symbolic link.`);
  }

  const projectRootReal = fs.realpathSync(projectRoot);
  const wikiRootReal = fs.realpathSync(wikiRoot);
  if (!isPathInside(projectRootReal, wikiRootReal)) {
    throw new Error(`${normalizedWikiDir}/ resolves outside the project root.`);
  }
  const sourcePaths = collectDocumentationFiles(wikiRoot, normalizedWikiDir);
  const headingCache = new Map();

  for (const sourcePath of sourcePaths) {
    report.filesScanned += 1;
    const sourceAbsolutePath = path.resolve(projectRoot, sourcePath);
    const content = fs.readFileSync(sourceAbsolutePath, "utf8");
    const sourceAnchors = getHeadingAnchors(sourceAbsolutePath, content, headingCache);

    for (const link of extractMarkdownLinks(content)) {
      report.linksChecked += 1;
      const issue = validateLink({
        href: link.href,
        line: link.line,
        projectRoot,
        sourceAnchors,
        sourcePath,
        wikiDir: normalizedWikiDir,
        wikiRootReal,
        headingCache,
      });
      if (issue) report.issues.push(issue);
    }
  }

  return report;
}

export function formatWikiLinkIssues(report, limit = 5) {
  if (report.issues.length === 0) return "Harness Wiki internal links are valid.";
  const shown = report.issues
    .slice(0, limit)
    .map((issue) => `${issue.sourcePath}:${issue.line} [${issue.href}] ${issue.message}`);
  const remaining = report.issues.length - shown.length;
  if (remaining > 0) shown.push(`...and ${remaining} more issue(s).`);
  return `Harness Wiki internal link validation found ${report.issues.length} issue(s): ${shown.join("; ")}`;
}

function validateLink({
  href: rawHref,
  line,
  projectRoot,
  sourceAnchors,
  sourcePath,
  wikiDir,
  wikiRootReal,
  headingCache,
}) {
  const href = stripOptionalLinkTitle(rawHref.trim());
  if (!href || isExternalHref(href)) return null;

  const hashIndex = href.indexOf("#");
  const rawLinkPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const rawAnchor = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  let linkPath;
  let anchor;
  try {
    linkPath = decodeURIComponent(rawLinkPath.split("?", 1)[0]);
    anchor = decodeURIComponent(rawAnchor);
  } catch {
    return createIssue(sourcePath, line, rawHref, "contains invalid percent encoding");
  }

  if (!linkPath) {
    if (!anchor || sourceAnchors.has(anchor)) return null;
    return createIssue(sourcePath, line, rawHref, `heading anchor "${anchor}" does not exist`);
  }

  const posixSource = sourcePath.replace(/\\/gu, "/");
  const candidate = path.posix.normalize(
    linkPath.startsWith("/")
      ? path.posix.join(wikiDir, linkPath.replace(/^\/+/, ""))
      : path.posix.join(path.posix.dirname(posixSource), linkPath),
  );
  const relativeToWiki = path.posix.relative(wikiDir, candidate);
  if (relativeToWiki.startsWith("..") || path.posix.isAbsolute(relativeToWiki)) {
    return createIssue(sourcePath, line, rawHref, "points outside the wiki root");
  }

  const targetAbsolutePath = path.resolve(projectRoot, candidate);
  let targetInfo;
  try {
    targetInfo = fs.lstatSync(targetAbsolutePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return createIssue(sourcePath, line, rawHref, `target "${linkPath}" does not exist`);
    }
    throw error;
  }

  if (targetInfo.isSymbolicLink()) {
    return createIssue(sourcePath, line, rawHref, `target "${linkPath}" is a symbolic link`);
  }

  const targetRealPath = fs.realpathSync(targetAbsolutePath);
  if (!isPathInside(wikiRootReal, targetRealPath)) {
    return createIssue(sourcePath, line, rawHref, "resolves outside the wiki root");
  }

  if (linkPath.endsWith("/")) {
    return targetInfo.isDirectory()
      ? null
      : createIssue(sourcePath, line, rawHref, `target "${linkPath}" is not a directory`);
  }
  if (!targetInfo.isFile()) {
    return createIssue(sourcePath, line, rawHref, `target "${linkPath}" is not a file`);
  }
  if (!anchor) return null;

  const targetAnchors = getHeadingAnchors(targetAbsolutePath, undefined, headingCache);
  if (targetAnchors.has(anchor)) return null;
  return createIssue(
    sourcePath,
    line,
    rawHref,
    `heading anchor "${anchor}" does not exist in "${linkPath}"`,
  );
}

function collectDocumentationFiles(absoluteDirectory, repositoryDirectory) {
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const repositoryPath = path.posix.join(repositoryDirectory, entry.name);
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDocumentationFiles(absolutePath, repositoryPath));
    } else if (entry.isFile() && isWikiDocumentationPath(repositoryPath)) {
      files.push(repositoryPath);
    }
  }
  return files.sort();
}

function extractMarkdownLinks(content) {
  const links = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(MARKDOWN_LINK_PATTERN)) {
      if (match.index !== undefined && lines[index][match.index - 1] === "!") continue;
      links.push({ href: match[2], line: index + 1 });
    }
  }
  return links;
}

function getHeadingAnchors(absolutePath, knownContent, cache) {
  const cached = cache.get(absolutePath);
  if (cached) return cached;
  const content = knownContent ?? fs.readFileSync(absolutePath, "utf8");
  const counts = new Map();
  const anchors = new Set();
  for (const line of content.split(/\r?\n/u)) {
    const match = HEADING_PATTERN.exec(line);
    if (!match) continue;
    const base = slugifyHeading(match[2]);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  cache.set(absolutePath, anchors);
  return anchors;
}

function slugifyHeading(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/gu, "-");
}

function stripOptionalLinkTitle(href) {
  return href.replace(/\s+(["']).*\1\s*$/u, "").trim();
}

function isExternalHref(href) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRepositoryPath(value) {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function createIssue(sourcePath, line, href, message) {
  return { sourcePath, line, href, message };
}
