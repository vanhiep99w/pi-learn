import fs from "node:fs";
import path from "node:path";
import { isLiteralSourcePath, matchesSourcePath, validSourcePaths } from "./wiki-source-paths.js";

export const WIKI_DOMAINS_PATH = "wiki/_domains.json";
export const MAX_POLICY_CONFIG_BYTES = 64 * 1024;
const ROOT_RULE = "wiki/_rules.md";
const NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const EXCLUDED = new Set(["assets", "node_modules", "dist", "build"]);

export class WikiPolicyError extends Error {
  constructor(code, message) { super(message); this.name = "WikiPolicyError"; this.code = code; }
}
function fail(code, message) { throw new WikiPolicyError(code, message); }
export function isWikiDomainsPath(value) {
  return typeof value === "string" && value.replace(/\\/gu, "/").replace(/^\.\//u, "").normalize("NFC").toLowerCase() === WIKI_DOMAINS_PATH;
}
export function isPolicyRulePath(value) {
  if (typeof value !== "string" || value.length > 1024) return false;
  const parts = value.split("/");
  return parts.length <= 64 && parts.length >= 2 && parts[0] === "wiki" && parts.at(-1) === "_rules.md"
    && parts.slice(1, -1).every((part) => part && !/^[._]/u.test(part) && !/[\\:\u0000-\u001f\u007f*?{}\[\]]/u.test(part) && !EXCLUDED.has(part.toLowerCase()));
}

/** Check components without reading policy text. Also used immediately around scaffold creation. */
export function safePolicyTarget(projectRoot, repositoryPath, allowMissing = false) {
  if (repositoryPath !== WIKI_DOMAINS_PATH && !isPolicyRulePath(repositoryPath)) fail("invalid_policy_path", "Use a canonical wiki/**/_rules.md policy path.");
  let absolute = fs.realpathSync(projectRoot);
  const parts = repositoryPath.split("/");
  for (let index = 0; index < parts.length; index++) {
    absolute = path.join(absolute, parts[index]);
    let stat;
    try { stat = fs.lstatSync(absolute); }
    catch (error) {
      if (error.code === "ENOENT" && allowMissing) return { absolute: path.join(absolute, ...parts.slice(index + 1)), exists: false };
      if (error.code === "ENOENT") fail("policy_rule_missing", "A required policy rule file is missing; run Wiki rule validation/scaffolding.");
      throw error;
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) fail("unsafe_policy_path", "Policy paths must use real directories and regular non-symlink files.");
  }
  return { absolute, exists: true };
}

/** No cache: edits/removal of the opt-in configuration take effect on the next call. */
export function readPolicyConfigText(projectRoot) {
  const target = safePolicyTarget(projectRoot, WIKI_DOMAINS_PATH, true);
  if (!target.exists) return null;
  const expected = fs.lstatSync(target.absolute);
  if (expected.size > MAX_POLICY_CONFIG_BYTES || expected.nlink !== 1) fail("invalid_policy_config", "Policy config must be at most 64 KiB with no hardlink aliases.");
  const fd = fs.openSync(target.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size > MAX_POLICY_CONFIG_BYTES) fail("unsafe_policy_path", "Policy config changed identity while opening.");
    safePolicyTarget(projectRoot, WIKI_DOMAINS_PATH);
    const bytes = Buffer.alloc(MAX_POLICY_CONFIG_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_POLICY_CONFIG_BYTES || bytes.subarray(0, length).includes(0)) fail("invalid_policy_config", "Policy config exceeds its bound or contains a NUL byte.");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { fail("invalid_policy_config", "Policy config must be valid UTF-8; source contents are not included in errors."); }
  } finally { fs.closeSync(fd); }
}

export function readPolicyDomainConfig(projectRoot) {
  const text = readPolicyConfigText(projectRoot);
  if (text === null) return null;
  let raw;
  try { raw = JSON.parse(text.replace(/^\ufeff/u, "")); }
  catch { fail("invalid_policy_config", "Policy config must be valid JSON; source contents are not included in errors."); }
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
  if (!object(raw) || !keys(raw, ["version", "domains"]) || raw.version !== 1 || !Array.isArray(raw.domains) || raw.domains.length > 100) fail("invalid_policy_config", "Use {version: 1, domains: [...]} with at most 100 domains.");
  const ids = new Set(), rules = new Set();
  for (const domain of raw.domains) {
    if (!object(domain) || !keys(domain, ["id", "rule", "paths", "tasks"]) || typeof domain.id !== "string" || !NAME.test(domain.id) || !isPolicyRulePath(domain.rule) || domain.rule === ROOT_RULE) fail("invalid_policy_config", "Each domain needs a unique lowercase id and a non-root wiki/**/_rules.md rule path.");
    if (ids.has(domain.id) || rules.has(domain.rule)) fail("invalid_policy_config", "Domain ids and rule paths must be unique; combine selectors for one domain.");
    ids.add(domain.id); rules.add(domain.rule);
    if (domain.paths !== undefined && (!validSourcePaths(domain.paths) || !domain.paths.length)) fail("invalid_policy_config", "Domain paths must be a nonempty array of unique literal project-relative scopes (directory scopes end with /).");
    if (domain.tasks !== undefined && (!Array.isArray(domain.tasks) || !domain.tasks.length || domain.tasks.length > 32 || domain.tasks.some((task) => typeof task !== "string" || !NAME.test(task)) || new Set(domain.tasks).size !== domain.tasks.length)) fail("invalid_policy_config", "Domain tasks must be unique lowercase names, at most 32 per domain.");
    if (domain.paths === undefined && domain.tasks === undefined) fail("invalid_policy_config", "Each domain needs paths and/or tasks; root rules are implicit.");
  }
  return raw;
}

/** Returns paths/selectors only, never policy contents or inferred permission/precedence.
 * @param {string} projectRoot
 * @param {{paths?: string[], task: string}} query
 */
export function resolveWikiPolicyDomains(projectRoot, { paths = [], task }) {
  if (!Array.isArray(paths) || paths.length > 100 || !paths.every(isLiteralSourcePath) || new Set(paths).size !== paths.length || typeof task !== "string" || !NAME.test(task)) fail("invalid_policy_query", "Supply task (lowercase name) and at most 100 unique literal project-relative paths.");
  const config = readPolicyDomainConfig(projectRoot);
  const rulePaths = new Set([ROOT_RULE]);
  const matches = config?.domains.filter((domain) => (!domain.tasks || domain.tasks.includes(task))
    && (!domain.paths || paths.some((source) => domain.paths.some((scope) => matchesSourcePath(scope, source))))) ?? [];
  for (const domain of matches) {
    // An existing ancestor rule remains applicable, even if only its child has selectors.
    const parts = domain.rule.split("/");
    for (let size = 1; size < parts.length - 2; size++) {
      const ancestor = `${parts.slice(0, size + 1).join("/")}/_rules.md`;
      if (safePolicyTarget(projectRoot, ancestor, true).exists) rulePaths.add(ancestor);
    }
    safePolicyTarget(projectRoot, domain.rule);
    rulePaths.add(domain.rule);
  }
  safePolicyTarget(projectRoot, ROOT_RULE);
  return {
    mode: config ? "domains" : "legacy", configPath: config ? WIKI_DOMAINS_PATH : null, task, paths,
    rulePaths: [...rulePaths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)),
    matches: matches.map((domain) => ({ id: domain.id, rule: domain.rule })),
    unmatchedPaths: config ? paths.filter((source) => !matches.some((domain) => !domain.paths || domain.paths.some((scope) => matchesSourcePath(scope, source)))) : paths,
    note: config ? "Declared domains only. Paths and tasks within a domain are ANDed; matching domains are unioned. Read applicable rules only before edits; conflicts must be reported, not overridden. This does not grant mutation permission."
      : "No opt-in config: legacy discovery/scaffolding is unchanged. Root is only the known minimum, not the complete applicable policy set; consult quickstart/agent guidance for domain rules.",
  };
}
