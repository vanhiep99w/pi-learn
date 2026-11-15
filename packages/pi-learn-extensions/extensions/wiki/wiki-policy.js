import fs from "node:fs";
import path from "node:path";
import { isLiteralSourcePath } from "./wiki-source-paths.js";

const ROOT_RULE = "wiki/_rules.md";
const NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const EXCLUDED = new Set(["assets", "node_modules", "dist", "build"]);

export class WikiPolicyError extends Error {
  constructor(code, message) { super(message); this.name = "WikiPolicyError"; this.code = code; }
}
function fail(code, message) { throw new WikiPolicyError(code, message); }
export function isPolicyRulePath(value) {
  if (typeof value !== "string" || value.length > 1024) return false;
  const parts = value.split("/");
  return parts.length <= 64 && parts.length >= 2 && parts[0] === "wiki" && parts.at(-1) === "_rules.md"
    && parts.slice(1, -1).every((part) => part && !/^[._]/u.test(part) && !/[\\:\u0000-\u001f\u007f*?{}\[\]]/u.test(part) && !EXCLUDED.has(part.toLowerCase()));
}

/** Check components without reading policy text. Also used immediately around scaffold creation. */
export function safePolicyTarget(projectRoot, repositoryPath, allowMissing = false) {
  if (!isPolicyRulePath(repositoryPath)) fail("invalid_policy_path", "Use a canonical wiki/**/_rules.md policy path.");
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

/** Exact top-level service -> wiki/modules/<service>/_rules.md, even before it exists.
 * Inspect path types, never source/rule contents; missing descendants may be edit targets.
 */
function serviceConventionMatch(projectRoot, source) {
  const parts = source.replace(/\/$/u, "").split("/");
  const service = parts[0];
  const rule = `wiki/modules/${service}/_rules.md`;
  // Wiki document paths are not source service scopes. No aliases or nested-name guesses.
  if (service === "wiki" || !isPolicyRulePath(rule)) return null;
  let absolute = fs.realpathSync(projectRoot);
  for (let index = 0; index < parts.length; index++) {
    absolute = path.join(absolute, parts[index]);
    let stat;
    try { stat = fs.lstatSync(absolute); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (index === 0) return null;
      break;
    }
    if (stat.isSymbolicLink()) fail("unsafe_policy_path", "Service scopes must not traverse symlinks.");
    if (index === 0 && !stat.isDirectory()) return null;
    if (index < parts.length - 1 || source.endsWith("/")) {
      if (!stat.isDirectory()) fail("unsafe_policy_path", "Service scopes must traverse real directories.");
    } else if (!stat.isFile() && !stat.isDirectory()) fail("unsafe_policy_path", "Service scopes must name regular files or real directories.");
  }
  return { service, rule, exists: safePolicyTarget(projectRoot, rule, true).exists };
}

/** Returns existing paths and missing service targets separately, never file contents.
 * @param {string} projectRoot
 * @param {{paths?: string[], task: string}} query
 */
export function resolveWikiRules(projectRoot, { paths = [], task }) {
  if (!Array.isArray(paths) || paths.length > 100 || !paths.every(isLiteralSourcePath) || new Set(paths).size !== paths.length || typeof task !== "string" || !NAME.test(task)) fail("invalid_policy_query", "Supply task (lowercase name) and at most 100 unique literal project-relative paths.");
  const rulePaths = new Set();
  if (safePolicyTarget(projectRoot, ROOT_RULE, true).exists) rulePaths.add(ROOT_RULE);
  const matches = [...new Map(paths.map((source) => serviceConventionMatch(projectRoot, source))
    .filter(Boolean).map((match) => [match.service, match])).values()];
  const suggestedRulePaths = [];
  for (const match of matches) {
    // Existing root/ancestor policies remain additive when the leaf is still missing.
    if (safePolicyTarget(projectRoot, "wiki/modules/_rules.md", true).exists) rulePaths.add("wiki/modules/_rules.md");
    if (match.exists) rulePaths.add(match.rule);
    else suggestedRulePaths.push(match.rule);
  }
  const compare = (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b);
  return {
    mode: matches.length ? "convention" : "legacy", task, paths,
    rulePaths: [...rulePaths].sort(compare), suggestedRulePaths: suggestedRulePaths.sort(compare), matches,
    unmatchedPaths: paths.filter((source) => !matches.some(({ service }) => source === service || source.startsWith(`${service}/`))),
    note: "Exact real top-level service names route to wiki/modules/<service>/_rules.md, even when missing. Read only existing rulePaths with read, not wiki_get. suggestedRulePaths are missing targets, not files to read. Existing ancestors are additive; consult quickstart for remaining rules. No contents, writes, scaffolds or inferred policy permission.",
  };
}
