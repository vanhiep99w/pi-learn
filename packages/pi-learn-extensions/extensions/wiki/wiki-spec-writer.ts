// SPDX-License-Identifier: Apache-2.0
// Adapted from ThinkRail spec_create/spec_update; core serialization/editing stays upstream.
// Source + pinned commit/license: vendor/thinkrail-spec-graph/{ORIGIN.json,LICENSE}.
// Pi Learn adds Wiki-only path/permission checks, strict authoring, revision and queue guards.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMap, parseDocument } from "yaml";
import {
  buildGraph, FIELDS, type Frontmatter, type FrontmatterEdit, isValid, LIST_FIELDS,
  parseFile, resolveSpecPath, serializeFrontmatter, SPEC_TYPES, updateFrontmatterText, validateGraph,
} from "./vendor/thinkrail-spec-graph/core/index.ts";
import { isWikiReadPath, MAX_WIKI_DOCUMENT_BYTES, readWikiDocument, WikiModelError, WikiReadModel } from "./wiki-model.ts";
import { validSourcePaths, WIKI_SOURCE_PATHS_FIELD } from "./wiki-source-paths.js";
export const WIKI_LIST_FIELDS = [...LIST_FIELDS, WIKI_SOURCE_PATHS_FIELD] as const;

export const DURABLE_SPEC_TYPES = SPEC_TYPES.filter((type) => type !== "task-spec");
export type DurableSpecType = (typeof DURABLE_SPEC_TYPES)[number];
export interface CreateWikiSpec {
  path: string; id: string; type: DurableSpecType; title: string; parent?: string;
  dependsOn?: string[]; references?: string[]; implements?: string[]; covers?: string[]; tags?: string[]; sourcePaths?: string[];
}
export interface UpdateWikiSpec extends FrontmatterEdit { id: string; expectedRevision: string }
export type FileMutationQueue = <T>(absolutePath: string, operation: () => Promise<T>) => Promise<T>;

const repositoryQueues = new Map<string, Promise<void>>();
const revision = (text: string) => createHash("sha256").update(text).digest("hex");
function fail(code: string, message: string): never { throw new WikiModelError(code, message); }

function roots(projectRoot: string) {
  const root = realpathSync(path.resolve(projectRoot));
  const wiki = path.join(root, "wiki");
  const stat = lstatSync(wiki);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(wiki) !== wiki) fail("unsafe_path", "wiki/ must be a real directory inside this project.");
  return { root, wiki };
}
function target(wiki: string, value: string) {
  const relative = value.replace(/^@/u, "").replace(/\\/gu, "/");
  if (!isWikiReadPath(relative)) fail("reserved_path", "Only normal Wiki-relative Markdown paths may be written; no rules, brief, metadata, scratch or assets.");
  const resolved = resolveSpecPath(wiki, relative);
  if ("error" in resolved || !isWikiReadPath(resolved.rel)) fail("unsafe_path", "Spec path is not safely indexable inside wiki/.");
  return resolved;
}
function boundedString(value: unknown, name: string, maximum = 256) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail("invalid_authoring", `${name} must be a trimmed nonempty string without control characters (max ${maximum}).`);
}
function validateContent(content: string) {
  if (Buffer.byteLength(content) > MAX_WIKI_DOCUMENT_BYTES) fail("document_too_large", "Spec would exceed the read model's 1 MiB limit.");
  const lines = content.replace(/^\ufeff/u, "").split(/\r?\n/u);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  const doc = parseDocument(lines.slice(1, end).join("\n"));
  if (lines[0]?.trim() !== "---" || end < 1 || doc.errors.length || doc.warnings.length || !isMap(doc.contents)) fail("invalid_authoring", "Spec frontmatter must be a valid YAML mapping without unresolved tags/warnings.");
  const raw = doc.toJS({ maxAliasCount: 100 }) as Record<string, unknown>;
  for (const field of ["id", "type", "title"]) boundedString(raw[field], field);
  if (!(DURABLE_SPEC_TYPES as readonly unknown[]).includes(raw.type)) fail("invalid_authoring", "Authoring requires a supported durable spec type, not task-spec.");
  if (raw.parent !== undefined) boundedString(raw.parent, "parent");
  if (raw.status !== undefined && !["draft", "active", "stale", "deprecated"].includes(raw.status as string)) fail("invalid_authoring", "Durable specs use draft/active/stale/deprecated status.");
  if (raw[WIKI_SOURCE_PATHS_FIELD] !== undefined && !validSourcePaths(raw[WIKI_SOURCE_PATHS_FIELD])) fail("invalid_authoring", "source-paths must be unique literal project-relative scopes (at most 200); directory scopes end with /, no globs/traversal.");
  for (const field of WIKI_LIST_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > 200) fail("invalid_authoring", `${field} must be a string array of at most 200 items.`);
    for (const item of value) boundedString(item, field, field === WIKI_SOURCE_PATHS_FIELD ? 1024 : 256);
  }
  return parseFile(content).frontmatter!;
}
/** Thin gap adapter: upstream list editing only knows its own fields. Keep its base edits,
 * and use the same YAML AST API for the one Wiki-specific list, preserving body/comments. */
function updateSourcePaths(content: string, edit: FrontmatterEdit): string {
  const add = edit.addList?.[WIKI_SOURCE_PATHS_FIELD] ?? [];
  const remove = edit.removeList?.[WIKI_SOURCE_PATHS_FIELD] ?? [];
  if (!add.length && !remove.length) return content;
  const bom = content.startsWith("\ufeff") ? "\ufeff" : "";
  const lines = content.slice(bom.length).split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  const doc = parseDocument(lines.slice(1, end).map((line) => line.replace(/\r$/u, "")).join("\n"));
  const current = parseFile(content).frontmatter?.[WIKI_SOURCE_PATHS_FIELD] ?? [];
  if (!Array.isArray(current)) fail("invalid_authoring", "Repair source-paths into a string array before metadata editing.");
  const next = [...new Set([...current, ...add])].filter((scope) => !remove.includes(scope));
  if (next.length) doc.set(WIKI_SOURCE_PATHS_FIELD, doc.createNode(next));
  else doc.delete(WIKI_SOURCE_PATHS_FIELD);
  const block = `---\n${doc.toString({ lineWidth: 0 })}---\n`;
  return bom + (lines[0].endsWith("\r") ? block.replace(/\n/g, "\r\n") : block) + lines.slice(end + 1).join("\n");
}
function checkGraph(model: WikiReadModel, repositoryPath: string, frontmatter: Frontmatter) {
  const snapshot = model.read();
  if (snapshot.diagnostics.some((item) => item.severity === "error" && !["dangling_link", "parent_cycle"].includes(item.code))) fail("wiki_invalid", "Repair Wiki schema/I/O/duplicate errors before using spec mutation tools.");
  const entries = snapshot.documents.filter((document) => document.kind === "spec" && document.path !== repositoryPath)
    .map((document) => ({ path: document.path, frontmatter: document.frontmatter! }));
  entries.push({ path: repositoryPath, frontmatter });
  if (!isValid(validateGraph(buildGraph(entries)))) fail("graph_invalid", "This write would leave duplicate IDs, dangling links or parent cycles. Create parents/targets first or repair the existing graph.");
}

/** Serialize spec mutations across paths/instances, then join Pi's built-in per-file queue. */
async function queued<T>(root: string, absolute: string, queue: FileMutationQueue, check: () => void, signal: AbortSignal | undefined, operation: () => T): Promise<T> {
  const previous = repositoryQueues.get(root) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  repositoryQueues.set(root, current);
  try {
    await previous;
    return await queue(absolute, async () => {
      check();
      if (signal?.aborted) fail("cancelled", "Spec mutation cancelled before writing.");
      return operation(); // All preflight + actual write is synchronous inside this queue window.
    });
  } finally {
    release();
    if (repositoryQueues.get(root) === current) repositoryQueues.delete(root);
  }
}

export class WikiSpecWriter {
  constructor(privateOptions: { queue: FileMutationQueue }) { this.queue = privateOptions.queue; }
  private readonly queue: FileMutationQueue;

  async create(projectRoot: string, params: CreateWikiSpec, check: () => void, signal?: AbortSignal) {
    check();
    const { root, wiki } = roots(projectRoot);
    const resolved = target(wiki, params.path);
    return queued(root, resolved.abs, this.queue, check, signal, () => {
      roots(projectRoot); const fresh = target(wiki, params.path);
      try { lstatSync(fresh.abs); fail("already_exists", "Spec create never overwrites an existing file or converts a guide."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const model = new WikiReadModel(root);
      const snapshot = model.read();
      if (snapshot.documents.some((document) => document.frontmatter?.id === params.id)) fail("duplicate_id", "Spec id is already in use.");
      const fm: Frontmatter = { id: params.id, type: params.type, status: "draft", title: params.title };
      if (params.parent !== undefined) fm.parent = params.parent;
      for (const [input, field] of [["dependsOn", FIELDS.dependsOn], ["references", FIELDS.references], ["implements", FIELDS.implements], ["covers", FIELDS.covers], ["tags", FIELDS.tags], ["sourcePaths", WIKI_SOURCE_PATHS_FIELD]] as const) {
        if (params[input] !== undefined) fm[field] = params[input]!;
      }
      const headings = params.type === "goal-and-requirements" ? ["Goal", "Scope"]
        : params.type === "architecture-design" ? ["Drivers", "Decisions", "Invariants", "Out of scope"] : ["Responsibility", "Boundary"];
      const content = `${serializeFrontmatter(fm)}\n${headings.map((heading) => `## ${heading}\n`).join("\n")}`;
      // Validate input lists before serializeFrontmatter can silently discard an empty/wrong value.
      boundedString(params.id, "id"); boundedString(params.title, "title");
      for (const field of ["dependsOn", "references", "implements", "covers", "tags", "sourcePaths"] as const) if (params[field] !== undefined && (!Array.isArray(params[field]) || params[field]!.length > 200)) fail("invalid_authoring", "List inputs must be arrays of at most 200 strings.");
      const frontmatter = validateContent(content);
      checkGraph(model, `wiki/${fresh.rel}`, frontmatter);
      check();
      mkdirSync(path.dirname(fresh.abs), { recursive: true });
      const final = target(wiki, fresh.rel); // Recheck new directories before exclusive creation.
      writeFileSync(final.abs, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
      return { path: `wiki/${final.rel}`, id: params.id, status: "draft", revision: revision(content), scaffoldOnly: true };
    });
  }

  async update(projectRoot: string, params: UpdateWikiSpec, check: () => void, signal?: AbortSignal) {
    check();
    const { root, wiki } = roots(projectRoot);
    const initial = new WikiReadModel(root).get({ id: params.id });
    const resolved = target(wiki, initial.path.slice(5));
    return queued(root, resolved.abs, this.queue, check, signal, () => {
      roots(projectRoot);
      const model = new WikiReadModel(root);
      const metadata = model.get({ id: params.id });
      if (metadata.path !== initial.path) fail("stale_revision", "Spec moved while queued; resolve it again with wiki_get.");
      const fresh = target(wiki, metadata.path.slice(5));
      const before = readWikiDocument(wiki, fresh.abs);
      if (!/^[a-f0-9]{64}$/u.test(params.expectedRevision) || revision(before) !== params.expectedRevision) fail("stale_revision", "Spec changed; read it and obtain a new revision from wiki_get before editing metadata.");
      for (const field of Object.keys(params.set ?? {})) {
        if (!["type", "title", "status", "parent"].includes(field)) fail("invalid_edit", "Only type/title/status/parent scalar fields may be set; id is immutable and lists have addList/removeList.");
      }
      if (params.set?.status !== undefined && !["draft", "stale", "deprecated"].includes(params.set.status)) fail("review_required", "Spec tools do not promote specs to active/done. Review/status approval is a separate user-owned decision.");
      for (const field of params.remove ?? []) if (!["parent", ...WIKI_LIST_FIELDS].includes(field)) fail("invalid_edit", "Only parent/list fields may be removed; identity, title and review status are protected.");
      for (const group of [params.addList, params.removeList]) for (const [field, values] of Object.entries(group ?? {})) {
        if (!(WIKI_LIST_FIELDS as readonly string[]).includes(field) || !Array.isArray(values) || values.length > 200) fail("invalid_edit", "Use known list fields with arrays of at most 200 strings.");
        values.forEach((item) => boundedString(item, field, field === WIKI_SOURCE_PATHS_FIELD ? 1024 : 256));
      }
      const result = updateFrontmatterText(before, params);
      if ("error" in result) fail("invalid_edit", "Frontmatter update rejected; preserve required identity and use list operations for list fields.");
      result.content = updateSourcePaths(result.content, params);
      const frontmatter = validateContent(result.content);
      checkGraph(model, metadata.path, frontmatter);
      if (result.content === before) return { path: metadata.path, id: params.id, revision: revision(before), changed: false };
      // No truncating pathname open. Check inode + current bytes before writing through the fd.
      const expected = lstatSync(fresh.abs);
      const fd = openSync(fresh.abs, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const actual = fstatSync(fd);
        if (!actual.isFile() || actual.nlink !== 1 || actual.ino !== expected.ino || actual.dev !== expected.dev || actual.size > MAX_WIKI_DOCUMENT_BYTES) fail("unsafe_path", "Metadata update requires an unchanged regular file without hardlink aliases.");
        const bytes = Buffer.alloc(actual.size + 1);
        const count = readSync(fd, bytes, 0, bytes.length, 0);
        if (revision(bytes.subarray(0, count).toString("utf8")) !== params.expectedRevision) fail("stale_revision", "Spec changed during update; retry from wiki_get.");
        roots(projectRoot); target(wiki, fresh.rel); check();
        const now = lstatSync(fresh.abs);
        if (now.ino !== actual.ino || now.dev !== actual.dev) fail("stale_revision", "Spec file identity changed; retry from wiki_get.");
        // readSync used an explicit position; fd offset is still 0 for writeFileSync.
        writeFileSync(fd, result.content, "utf8");
        ftruncateSync(fd, Buffer.byteLength(result.content));
        fsyncSync(fd);
      } finally { closeSync(fd); }
      return { path: metadata.path, id: params.id, revision: revision(result.content), changed: true };
    });
  }
}
