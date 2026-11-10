import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isMap, parseDocument } from "yaml";
import { wikiHeadings } from "./wiki-headings.js";
import { isLiteralSourcePath, matchesSourcePath, validSourcePaths, WIKI_SOURCE_PATHS_FIELD } from "./wiki-source-paths.js";
import { isWikiDocumentationPath, MAX_WIKI_RULE_FILE_BYTES } from "./wiki-rules.js";
import {
  buildGraph, FIELDS, graphSlice, grepSpecs, IDENTITY_FIELDS, isSpec,
  LINK_KINDS, LIST_FIELDS, REQUIRED_FIELDS, resolveSpecPath, SINGLE_LINK_FIELDS,
  SPEC_STATUSES, SPEC_TYPES, SpecIndex, validateGraph,
  type DocumentFileRecord, type Frontmatter, type GrepOptions, type SliceOptions,
  type SpecGraph,
} from "./vendor/thinkrail-spec-graph/core/index.ts";

// This is an internal, Pi-free read model, not a registered tool or mutation API.
export const MAX_WIKI_DOCUMENT_BYTES = 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set(["assets", "node_modules", "dist", "build"]);

export interface WikiDiagnostic {
  path: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface WikiDocument {
  path: string;
  kind: "spec" | "guide" | "invalid";
  content: string;
  frontmatter: Frontmatter | null;
}

export interface WikiReadSnapshot {
  projectRoot: string;
  wikiRoot: string;
  documents: WikiDocument[];
  graph: SpecGraph;
  diagnostics: WikiDiagnostic[];
}

export class WikiModelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WikiModelError";
    this.code = code;
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Same policy for traversal and lookup; reserved files are rejected before their contents are read. */
export function isWikiReadPath(relativePath: string, directory = false): boolean {
  if (!relativePath || path.posix.isAbsolute(relativePath) || /[:\\\u0000]/u.test(relativePath)) return false;
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /^[._]/u.test(segment))) return false;
  const folded = segments.map((segment) => segment.normalize("NFC").toLowerCase());
  if (folded.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  // Fail closed for case/Unicode aliases, even on a case-sensitive checkout.
  if (folded.some((segment) => segment === "instructions.md" || segment === "_rules.md")) return false;
  return directory || isWikiDocumentationPath(`wiki/${relativePath}`);
}

export function isWikiRuleValidationPath(relativePath: string): boolean {
  return path.posix.basename(relativePath) === "_rules.md"
    && isWikiReadPath(relativePath.replace(/_rules\.md$/u, "rule-validation.md"));
}

/** Separate, purpose-bound rule lint read; normal search/get never uses this path. */
export function readWikiRuleForValidation(wikiRoot: string, absolutePath: string): Buffer {
  return Buffer.from(readWikiFile(wikiRoot, absolutePath, true), "utf8");
}

export function readWikiDocument(wikiRoot: string, absolutePath: string): string {
  return readWikiFile(wikiRoot, absolutePath, false);
}

function readWikiFile(wikiRoot: string, absolutePath: string, ruleValidation: boolean): string {
  const rootStat = lstatSync(wikiRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !inside(wikiRoot, realpathSync(wikiRoot))) {
    throw new WikiModelError("wiki_invalid", "wiki/ must be a real directory inside the project.");
  }
  const relative = path.relative(wikiRoot, absolutePath).split(path.sep).join("/");
  if (!(ruleValidation ? isWikiRuleValidationPath(relative) : isWikiReadPath(relative))) {
    throw new WikiModelError("reserved_path", "Not a readable Wiki document for this operation.");
  }
  const maxBytes = ruleValidation ? MAX_WIKI_RULE_FILE_BYTES : MAX_WIKI_DOCUMENT_BYTES;
  const sizeError = () => new WikiModelError("document_too_large", `Wiki file exceeds the ${ruleValidation ? "64 KiB rule" : "1 MiB document"} read limit.`);
  const resolved = resolveSpecPath(wikiRoot, relative);
  if ("error" in resolved) throw new WikiModelError("unsafe_path", "Wiki document path is not safely indexable.");
  const real = realpathSync(resolved.abs);
  if (!inside(wikiRoot, real)) throw new WikiModelError("unsafe_path", "Wiki document resolves outside wiki/.");
  const expected = lstatSync(resolved.abs);
  if (!expected.isFile() || expected.isSymbolicLink()) throw new WikiModelError("unsafe_path", "Wiki document must be a regular non-symlink file.");
  const fd = openSync(resolved.abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino || !inside(wikiRoot, realpathSync(resolved.abs))) {
      throw new WikiModelError("unsafe_path", "Wiki document changed identity while opening.");
    }
    if (stat.size > maxBytes) throw sizeError();
    // Bound the actual read too: another editor can grow the file after fstat.
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maxBytes) throw sizeError();
    const content = bytes.subarray(0, length);
    if (content.includes(0)) throw new WikiModelError("nul_byte", "Wiki document contains a NUL byte.");
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      throw new WikiModelError("invalid_utf8", "Wiki document is not valid UTF-8.");
    }
  } finally {
    closeSync(fd);
  }
}

function inspectDocument(record: DocumentFileRecord): { document: WikiDocument; diagnostics: WikiDiagnostic[] } {
  const document: WikiDocument = {
    path: `wiki/${record.rel}`, kind: "guide", content: record.content, frontmatter: structuredClone(record.frontmatter),
  };
  const diagnostics: WikiDiagnostic[] = [];
  const issue = (code: string, message: string, severity: WikiDiagnostic["severity"] = "error") => {
    diagnostics.push({ path: document.path, code, severity, message });
  };
  const lines = record.content.replace(/^\ufeff/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return { document, diagnostics };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    issue("unclosed_frontmatter", "Opening frontmatter fence has no closing fence.");
  } else {
    try {
      const yaml = parseDocument(lines.slice(1, end).join("\n"));
      if (yaml.errors.length || !isMap(yaml.contents)) {
        issue("invalid_frontmatter", "Frontmatter must be a valid YAML mapping with unique keys.");
      } else {
        if (yaml.warnings.length) issue("frontmatter_warning", "YAML frontmatter has warnings; unsupported tags or directives may have been ignored.", "warning");
        const raw = yaml.toJS({ maxAliasCount: 100 }) as Record<string, unknown>;
        const candidate = IDENTITY_FIELDS.some((field) => Object.hasOwn(raw, field));
        if (candidate) {
          for (const field of IDENTITY_FIELDS) {
            const value = raw[field];
            if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
              issue("invalid_identity", `Spec ${field} must be a nonempty, trimmed string.`);
            }
          }
          for (const field of [...REQUIRED_FIELDS.filter((field) => !(IDENTITY_FIELDS as readonly string[]).includes(field)), FIELDS.status, ...SINGLE_LINK_FIELDS]) {
            if (raw[field] !== undefined && (typeof raw[field] !== "string" || !(raw[field] as string).trim())) {
              issue("invalid_scalar", `Spec ${field} must be a nonempty string when present.`);
            }
          }
          for (const field of LIST_FIELDS) {
            const value = raw[field];
            if (value === undefined) continue;
            if (typeof value === "string" && value.trim()) {
              issue("legacy_list_scalar", `Spec ${field} is a legacy scalar; prefer a string array.`, "warning");
            } else if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
              issue("invalid_list", `Spec ${field} must be a string array.`);
            }
          }
          if (raw[WIKI_SOURCE_PATHS_FIELD] !== undefined && !validSourcePaths(raw[WIKI_SOURCE_PATHS_FIELD])) {
            issue("invalid_source_paths", "source-paths must be at most 200 unique literal project-relative paths; directory scopes end with /, no globs or traversal.");
          }
          if (raw.title === undefined) issue("missing_title", "Legacy spec has no title; new specs require id, type and title.", "warning");
          if (typeof raw.type === "string" && !(SPEC_TYPES as readonly string[]).includes(raw.type)) issue("unknown_type", "Spec type is outside the authoring vocabulary; read model retains it.", "warning");
          if (typeof raw.status === "string" && !(SPEC_STATUSES as readonly string[]).includes(raw.status)) issue("unknown_status", "Spec status is outside the authoring vocabulary.", "warning");
          if (raw.type === "task-spec") issue("temporary_task_spec", "Prefer moving durable task knowledge into its owning module spec.", "warning");
          document.kind = isSpec(record.frontmatter) ? "spec" : "invalid";
        }
      }
    } catch {
      // Never expose raw YAML errors: they can embed source text.
      issue("invalid_frontmatter", "Frontmatter cannot be safely parsed as YAML.");
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) document.kind = "invalid";
  return { document, diagnostics };
}

/** Instance-owned cache: no watcher, persistence, global root map or captured session context. */
export class WikiReadModel {
  readonly projectRoot: string;
  readonly wikiRoot: string;
  private readonly index: SpecIndex;
  private ioDiagnostics: WikiDiagnostic[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = realpathSync(path.resolve(projectRoot));
    this.wikiRoot = path.join(this.projectRoot, "wiki");
    this.index = new SpecIndex(this.wikiRoot, {
      includePath: isWikiReadPath,
      readContent: (absolutePath) => readWikiDocument(this.wikiRoot, absolutePath),
      retainNonSpecs: true,
      // Compare content as well as stats: same-size edits with a restored mtime are visible.
      verifyContent: true,
      onError: (relativePath, operation, error) => {
        this.ioDiagnostics.push({
          path: relativePath ? `wiki/${relativePath}` : "wiki",
          code: error instanceof WikiModelError ? error.code : `${operation}_failed`,
          severity: "error",
          message: error instanceof WikiModelError ? error.message : `Cannot ${operation} Wiki document or directory.`,
        });
      },
    });
  }

  read(): WikiReadSnapshot {
    this.ioDiagnostics = [];
    try {
      const stat = lstatSync(this.wikiRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !inside(this.projectRoot, realpathSync(this.wikiRoot))) {
        throw new WikiModelError("wiki_invalid", "wiki/ must be a real directory inside the project.");
      }
    } catch (error) {
      return {
        projectRoot: this.projectRoot, wikiRoot: this.wikiRoot, documents: [], graph: buildGraph([]),
        diagnostics: [{ path: "wiki", code: error instanceof WikiModelError ? error.code : "wiki_unavailable", severity: "error", message: error instanceof WikiModelError ? error.message : "wiki/ is missing or inaccessible." }],
      };
    }
    const documents: WikiDocument[] = [];
    const diagnostics: WikiDiagnostic[] = [];
    for (const record of this.index.documentEntries()) {
      const inspected = inspectDocument(record);
      documents.push(inspected.document);
      diagnostics.push(...inspected.diagnostics);
    }
    diagnostics.unshift(...this.ioDiagnostics);
    const entries = documents.filter((document) => document.kind === "spec").map((document) => ({ path: document.path, frontmatter: document.frontmatter! }));
    let graph = buildGraph(entries);
    const duplicateIds = graph.duplicateIds;
    // Upstream picks the first duplicate. Wiki never presents that winner as canonical.
    if (duplicateIds.size) {
      graph = buildGraph(entries.filter((entry) => !duplicateIds.has(entry.frontmatter.id as string)));
      graph.duplicateIds = duplicateIds;
    }
    const report = validateGraph(graph);
    for (const duplicate of report.duplicateIds) {
      for (const duplicatePath of duplicate.paths) diagnostics.push({ path: duplicatePath, code: "duplicate_id", severity: "error", message: `Spec id ${duplicate.id} is ambiguous (${duplicate.paths.length} files).` });
    }
    for (const link of report.danglingLinks) diagnostics.push({ path: link.fromPath, code: duplicateIds.has(link.target) ? "ambiguous_link_target" : "dangling_link", severity: "error", message: `${link.kind} target ${link.target} ${duplicateIds.has(link.target) ? "has duplicate owners" : "does not exist"}.` });
    for (const cycle of report.parentCycles) {
      for (const id of cycle.ids) diagnostics.push({ path: graph.nodes.get(id)!.path, code: "parent_cycle", severity: "error", message: `Parent cycle includes ${cycle.ids.join(", ")}.` });
    }
    return { projectRoot: this.projectRoot, wikiRoot: this.wikiRoot, documents, graph, diagnostics };
  }

  validate() {
    const snapshot = this.read();
    return {
      valid: !snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      filesScanned: snapshot.documents.length,
      nodes: snapshot.graph.nodes.size,
      diagnostics: snapshot.diagnostics,
    };
  }

  /** Metadata by default; an explicit heading selects verbatim prose from this same snapshot. */
  get(selector: { id?: string; path?: string; heading?: string; occurrence?: number }) {
    if ((selector.id === undefined) === (selector.path === undefined)) throw new WikiModelError("invalid_selector", "Supply exactly one of id or path.");
    if (selector.heading !== undefined && (typeof selector.heading !== "string" || !selector.heading.trim())) throw new WikiModelError("invalid_heading", "Supply an exact heading title or #anchor.");
    if (selector.occurrence !== undefined && (selector.heading === undefined || selector.heading.startsWith("#") || !Number.isSafeInteger(selector.occurrence) || selector.occurrence < 1)) throw new WikiModelError("invalid_occurrence", "occurrence is a positive 1-based index for an exact heading title, not an anchor.");
    const snapshot = this.read();
    let target: string | undefined;
    if (selector.id !== undefined) {
      if (snapshot.graph.duplicateIds.has(selector.id)) throw new WikiModelError("duplicate_id", "Spec id is ambiguous; run validation and resolve duplicate owners.");
      target = snapshot.graph.nodes.get(selector.id)?.path;
    } else {
      const relative = selector.path!.replace(/^@/u, "").replace(/\\/gu, "/");
      if (!isWikiReadPath(relative)) throw new WikiModelError("reserved_path", "Path must identify a normal Wiki-relative Markdown document.");
      const resolved = resolveSpecPath(this.wikiRoot, relative);
      if ("error" in resolved || !isWikiReadPath(resolved.rel)) throw new WikiModelError("unsafe_path", "Path is not safely indexable inside wiki/.");
      target = `wiki/${resolved.rel}`;
    }
    const document = snapshot.documents.find((candidate) => candidate.path === target);
    if (!document) throw new WikiModelError("not_found", "Wiki document not found; search or validate the Wiki.");
    if (document.kind === "invalid") throw new WikiModelError("invalid_document", "Wiki document has schema errors; run validation.");
    const id = document.kind === "spec" ? document.frontmatter!.id as string : undefined;
    if (id && snapshot.graph.duplicateIds.has(id)) throw new WikiModelError("duplicate_id", "Spec id is ambiguous; run validation and resolve duplicate owners.");
    const headings = wikiHeadings(document.content);
    let section;
    if (selector.heading !== undefined) {
      const matches = headings.filter((heading) => selector.heading!.startsWith("#") ? heading.anchor === selector.heading!.slice(1) : heading.title === selector.heading);
      if (matches.length > 1 && selector.occurrence === undefined) throw new WikiModelError("ambiguous_heading", "Heading title is repeated; use occurrence (1-based) or its unique #anchor.");
      const selected = matches[(selector.occurrence ?? 1) - 1];
      if (!selected) throw new WikiModelError("heading_not_found", "Heading/occurrence not found. Get document metadata to list available headings; no body fallback.");
      const next = headings.find((heading) => heading.offset > selected.offset && heading.level <= selected.level);
      section = { title: selected.title, anchor: selected.anchor, startLine: selected.line,
        endLine: next ? next.line - 1 : document.content.split("\n").length,
        content: document.content.slice(selected.offset, next?.offset ?? document.content.length) };
    }
    return {
      path: document.path, kind: document.kind, frontmatter: document.frontmatter,
      headings: headings.slice(0, 100).map(({ title, level, anchor, line }) => ({ title, level, anchor, line })),
      headingsTruncated: headings.length > 100,
      ...(section ? { section } : {}),
      lineCount: document.content.split("\n").length,
      revision: createHash("sha256").update(document.content).digest("hex"),
      links: id ? {
        forward: Object.fromEntries(LINK_KINDS.map((kind) => [kind, snapshot.graph.forward[kind].get(id) ?? []])),
        reverse: Object.fromEntries(LINK_KINDS.map((kind) => [kind, snapshot.graph.reverse[kind].get(id) ?? []])),
      } : null,
    };
  }

  /** Literal source scopes are declarations, not inferred ownership or filesystem access. */
  locate(sourcePath: string) {
    if (!isLiteralSourcePath(sourcePath)) throw new WikiModelError("invalid_source_path", "Use a literal project-relative file or directory path, without globs, backslashes or traversal.");
    const snapshot = this.read();
    const matches = [];
    for (const document of snapshot.documents) {
      if (document.kind !== "spec") continue;
      const scopes = document.frontmatter![WIKI_SOURCE_PATHS_FIELD];
      if (!Array.isArray(scopes)) continue;
      const matched = scopes.filter((scope) => matchesSourcePath(scope, sourcePath));
      if (!matched.length) continue;
      const id = document.frontmatter!.id as string;
      if (snapshot.graph.duplicateIds.has(id)) throw new WikiModelError("duplicate_id", "A matching source owner has a duplicate spec id; validate and resolve it before lookup.");
      matches.push({ id, path: document.path, title: document.frontmatter!.title, sourcePaths: matched,
        specificity: Math.max(...matched.map((scope) => scope.length)) });
    }
    matches.sort((a, b) => b.specificity - a.specificity || a.path.localeCompare(b.path));
    return { sourcePath, matches: matches.slice(0, 200), totalMatches: matches.length, multipleOwners: matches.length > 1,
      truncated: matches.length > 200, diagnostics: snapshot.diagnostics,
      note: "Declared owners only; all matches are retained up to the stated cap. No automatic winner, source read, rename tracking or permission grant. No match does not prove no contract exists." };
  }

  search(options: GrepOptions & { scope?: "specs" | "guides" | "all" }) {
    const scope = options.scope ?? "specs";
    if (!["specs", "guides", "all"].includes(scope)) throw new WikiModelError("invalid_scope", "Unknown Wiki search scope.");
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new WikiModelError("invalid_limit", "Search limit must be an integer from 1 to 200.");
    const maxBytes = options.maxBytes ?? 16 * 1024;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 32 * 1024) throw new WikiModelError("invalid_budget", "Search text budget must be 1024–32768 bytes.");
    const snapshot = this.read();
    const entries = snapshot.documents.filter((document) => document.kind !== "invalid" && (scope === "all" || document.kind === (scope === "specs" ? "spec" : "guide"))).map((document) => ({ path: document.path, content: document.content, frontmatter: document.frontmatter ?? {} }));
    let result;
    try {
      result = grepSpecs(entries, { ...options, limit, maxBytes });
    } catch (error) {
      if (error instanceof SyntaxError) throw new WikiModelError("invalid_regex", "Search regex is invalid.");
      throw error;
    }
    // Upstream deliberately admits an oversized first match; the adapter bounds that snippet.
    const matches = result.matches.map((match) => {
      const budget = Math.min(512, maxBytes - Buffer.byteLength(`${match.path}:${match.line}: `) - 1);
      if (budget < 1) throw new WikiModelError("invalid_budget", "Search budget is too small for this document path.");
      let snippet = match.snippet;
      if (Buffer.byteLength(snippet) > budget) {
        snippet = new TextDecoder().decode(Buffer.from(snippet).subarray(0, Math.max(0, budget - 4))).replace(/\ufffd$/u, "") + "…";
      }
      return { ...match, snippet, snippetTruncated: snippet !== match.snippet };
    });
    return { ...result, matches, diagnostics: snapshot.diagnostics };
  }

  slice(options: SliceOptions) {
    const depth = options.depth ?? 1;
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > 4) throw new WikiModelError("invalid_depth", "Graph depth must be an integer from 0 to 4.");
    if (!["subtree", "ancestors", "neighbors"].includes(options.direction) || (options.edge !== undefined && !(LINK_KINDS as readonly string[]).includes(options.edge))) throw new WikiModelError("invalid_slice", "Unknown graph direction or edge kind.");
    const snapshot = this.read();
    if (snapshot.graph.duplicateIds.has(options.root)) throw new WikiModelError("duplicate_id", "Graph root id has duplicate owners.");
    if (!snapshot.graph.nodes.has(options.root)) throw new WikiModelError("not_found", "Graph root id does not exist.");
    const slice = graphSlice(snapshot.graph, { ...options, depth });
    // Only keep edges whose endpoints are represented by the bounded result.
    const nodes = slice.nodes.slice(0, 100);
    const missing = slice.missing.slice(0, 100);
    const included = new Set([...nodes.map((node) => node.id), ...missing]);
    const edges = slice.edges.filter((edge) => included.has(edge.from) && included.has(edge.to)).slice(0, 200);
    return { ...slice, nodes, missing, edges, truncated: nodes.length !== slice.nodes.length || missing.length !== slice.missing.length || edges.length !== slice.edges.length, diagnostics: snapshot.diagnostics };
  }
}
