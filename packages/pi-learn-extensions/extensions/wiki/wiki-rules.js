import fs from "node:fs";
import path from "node:path";
import { isWikiDomainsPath, readPolicyDomainConfig, safePolicyTarget, WIKI_DOMAINS_PATH } from "./wiki-policy.js";
export { isWikiDomainsPath, WIKI_DOMAINS_PATH } from "./wiki-policy.js";

export const WIKI_DIR = "wiki";
export const WIKI_RULE_BASENAME = "_rules.md";
export const WIKI_METADATA_PATH = "wiki/.last-update.json";
export const WIKI_INSTRUCTIONS_PATH = "wiki/INSTRUCTIONS.md";
export const WIKI_PLAN_PATH = "wiki/_plan.md";
export const MAX_WIKI_RULE_FILE_BYTES = 64 * 1024;

const RULE_ID_PATTERN = /^[A-Z][A-Z0-9-]{2,63}$/;
const RULE_HEADING_PATTERN = /^##\s+([A-Z][A-Z0-9-]{2,63})\s+(?:—|-)\s+.+$/gm;
const ORIGIN_LINE_PATTERN = /^Origin proposal:\s+`?(P-\d{4,})`?\s*$/;
const SKIPPED_SECTION_DIRS = new Set(["assets", "_tmp"]);

export function normalizeRepositoryPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

export function relativeProjectPath(projectRoot, value) {
  if (!projectRoot || value === undefined || value === null) return undefined;
  const raw = String(value).trim().replace(/^@/, "");
  if (!raw) return undefined;
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".") return "";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return normalizeRepositoryPath(relative);
}

export function isWikiRulePath(value) {
  const normalized = normalizeRepositoryPath(value);
  return normalized === `${WIKI_DIR}/${WIKI_RULE_BASENAME}`
    || (normalized.startsWith(`${WIKI_DIR}/`) && normalized.endsWith(`/${WIKI_RULE_BASENAME}`));
}

export function isWikiPolicyPath(value) {
  return isWikiRulePath(value) || isWikiDomainsPath(normalizeRepositoryPath(value));
}

export function isWikiMetadataPath(value) {
  return normalizeRepositoryPath(value) === WIKI_METADATA_PATH;
}

export function isWikiInstructionsPath(value) {
  return normalizeRepositoryPath(value) === WIKI_INSTRUCTIONS_PATH;
}

export function isWikiTemporaryPath(value) {
  const normalized = normalizeRepositoryPath(value);
  if (isWikiPolicyPath(normalized) || isWikiMetadataPath(normalized)) return false;
  if (normalized === WIKI_PLAN_PATH) return true;
  const segments = normalized.split("/");
  return segments.some((segment, index) => index > 0 && (segment.startsWith(".") || segment.startsWith("_")));
}

export function isWikiDocumentationPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return normalized.startsWith(`${WIKI_DIR}/`)
    && normalized.endsWith(".md")
    && !isWikiRulePath(normalized)
    && !isWikiInstructionsPath(normalized)
    && !isWikiTemporaryPath(normalized);
}

// Optional read hooks let the public read-only tool enforce stricter path policy;
// command/scaffold callers keep their existing behavior when hooks are absent.
/** @param {{projectRoot: string, includePath?: (path: string, directory: boolean) => boolean, readRuleFile?: (absolutePath: string) => Buffer}} options */
export function discoverWikiPromptRules({ projectRoot, includePath, readRuleFile }) {
  const root = path.resolve(projectRoot);
  const wikiRoot = path.join(root, WIKI_DIR);
  const report = {
    projectRoot: root,
    wikiRoot,
    wikiExists: false,
    rootRuleExists: false,
    files: [],
    sections: [],
    missingRuleSections: [],
    errors: [],
    warnings: [],
    ruleIds: [],
    valid: false,
  };

  if (!fs.existsSync(wikiRoot)) {
    report.errors.push({ path: WIKI_DIR, code: "wiki_missing", message: "wiki/ directory does not exist." });
    return report;
  }

  const wikiStat = fs.lstatSync(wikiRoot);
  if (!wikiStat.isDirectory() || wikiStat.isSymbolicLink()) {
    report.errors.push({ path: WIKI_DIR, code: "wiki_invalid", message: "wiki/ must be a real directory inside the project root." });
    return report;
  }
  report.wikiExists = true;

  const sectionPaths = new Set([WIKI_DIR]);
  walkWikiDirectory({ root, absoluteDir: wikiRoot, relativeDir: WIKI_DIR, sectionPaths, report, includePath });
  let config;
  report.mode = "legacy";
  try {
    config = readPolicyDomainConfig(root);
    if (config) report.mode = "domains";
  } catch (error) {
    report.mode = "invalid";
    report.errors.push({ path: WIKI_DOMAINS_PATH, code: error.code ?? "invalid_policy_config", message: "Cannot safely load policy-domain configuration; repair wiki/_domains.json before completion." });
  }
  report.sections = (config ? [WIKI_DIR, ...config.domains.map((domain) => path.posix.dirname(domain.rule))]
    : report.mode === "invalid" ? [WIKI_DIR] : [...sectionPaths]).sort(compareRulePaths);
  report.files.sort(compareRulePaths);
  report.rootRuleExists = report.files.includes(`${WIKI_DIR}/${WIKI_RULE_BASENAME}`);

  if (!report.rootRuleExists) {
    report.errors.push({
      path: `${WIKI_DIR}/${WIKI_RULE_BASENAME}`,
      code: "root_rule_missing",
      message: `Missing root prompt-rule file: ${WIKI_DIR}/${WIKI_RULE_BASENAME}.`,
    });
  }

  for (const section of report.sections) {
    const rulePath = `${section}/${WIKI_RULE_BASENAME}`;
    if (!report.files.includes(rulePath)) {
      report.missingRuleSections.push(section);
      report.errors.push({ path: rulePath, code: "section_rule_missing", message: `Wiki section is missing ${WIKI_RULE_BASENAME}: ${section}.` });
    }
  }

  const idsByFile = new Map();
  for (const rulePath of report.files) {
    if (config) {
      try { safePolicyTarget(root, rulePath); }
      catch { report.errors.push({ path: rulePath, code: "unsafe_policy_path", message: "Configured policy mode requires regular rule files without symlink components." }); continue; }
    }
    const lint = lintWikiPromptRuleFile({ projectRoot: root, rulePath, readRuleFile });
    report.errors.push(...lint.errors);
    report.warnings.push(...lint.warnings);
    idsByFile.set(rulePath, lint.ruleIds);
    for (const id of lint.ruleIds) report.ruleIds.push({ id, path: rulePath });
  }

  const projectIds = new Map();
  for (const [rulePath, ids] of idsByFile) {
    for (const id of ids) {
      if (!projectIds.has(id)) projectIds.set(id, []);
      projectIds.get(id).push(rulePath);
    }
  }
  for (const [id, paths] of projectIds) {
    if (paths.length > 1) {
      report.warnings.push({
        path: paths.join(", "),
        code: "duplicate_project_rule_id",
        message: `Prompt rule ID ${id} appears in multiple section files: ${paths.join(", ")}.`,
      });
    }
  }

  report.valid = report.errors.length === 0;
  return report;
}

/** @param {{projectRoot: string, rulePath: string, readRuleFile?: (absolutePath: string) => Buffer}} options */
export function lintWikiPromptRuleFile({ projectRoot, rulePath, readRuleFile }) {
  const root = path.resolve(projectRoot);
  const normalized = normalizeRepositoryPath(rulePath);
  const result = { path: normalized, ruleIds: [], errors: [], warnings: [] };

  if (!isWikiRulePath(normalized)) {
    result.errors.push({ path: normalized, code: "invalid_rule_path", message: `Prompt-rule file must use wiki/**/${WIKI_RULE_BASENAME}: ${normalized}.` });
    return result;
  }

  const absolutePath = path.resolve(root, normalized);
  if (!isInsideRoot(root, absolutePath)) {
    result.errors.push({ path: normalized, code: "path_escape", message: `Prompt-rule path escapes project root: ${normalized}.` });
    return result;
  }
  if (!fs.existsSync(absolutePath)) {
    result.errors.push({ path: normalized, code: "rule_missing", message: `Prompt-rule file does not exist: ${normalized}.` });
    return result;
  }

  const stat = fs.lstatSync(absolutePath);
  let contentStat = stat;
  if (stat.isSymbolicLink()) {
    let real;
    try {
      real = fs.realpathSync(absolutePath);
    } catch (error) {
      result.errors.push({ path: normalized, code: "broken_symlink", message: `Cannot resolve prompt-rule symlink: ${error.message}` });
      return result;
    }
    if (!isInsideRoot(root, real)) {
      result.errors.push({ path: normalized, code: "symlink_escape", message: `Prompt-rule symlink points outside project root: ${normalized}.` });
      return result;
    }
    contentStat = fs.statSync(real);
    if (!contentStat.isFile()) {
      result.errors.push({ path: normalized, code: "not_file", message: `Prompt-rule symlink does not resolve to a file: ${normalized}.` });
      return result;
    }
  } else if (!stat.isFile()) {
    result.errors.push({ path: normalized, code: "not_file", message: `Prompt-rule path is not a file: ${normalized}.` });
    return result;
  }

  if (contentStat.size > MAX_WIKI_RULE_FILE_BYTES) {
    result.errors.push({
      path: normalized,
      code: "rule_file_too_large",
      message: `Prompt-rule file exceeds ${MAX_WIKI_RULE_FILE_BYTES} bytes: ${normalized} (${contentStat.size} bytes).`,
    });
    return result;
  }

  const buffer = readRuleFile ? readRuleFile(absolutePath) : fs.readFileSync(absolutePath);
  if (buffer.includes(0)) {
    result.errors.push({ path: normalized, code: "nul_byte", message: `Prompt-rule file contains a NUL byte: ${normalized}.` });
    return result;
  }

  let markdown;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    result.errors.push({ path: normalized, code: "invalid_utf8", message: `Prompt-rule file is not valid UTF-8: ${error.message}` });
    return result;
  }

  const seen = new Set();
  for (const match of markdown.matchAll(RULE_HEADING_PATTERN)) {
    const id = match[1];
    if (!RULE_ID_PATTERN.test(id)) {
      result.errors.push({ path: normalized, code: "invalid_rule_id", message: `Invalid prompt rule ID: ${id}.` });
      continue;
    }
    if (seen.has(id)) {
      result.errors.push({ path: normalized, code: "duplicate_rule_id", message: `Duplicate prompt rule ID in ${normalized}: ${id}.` });
      continue;
    }
    seen.add(id);
    result.ruleIds.push(id);
  }

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("Origin proposal:") && !ORIGIN_LINE_PATTERN.test(line.trim())) {
      result.errors.push({ path: normalized, code: "invalid_origin_proposal", message: `Invalid Origin proposal line in ${normalized}: ${line.trim()}.` });
    }
  }

  if (!markdown.trim()) {
    result.warnings.push({ path: normalized, code: "empty_rule_file", message: `Prompt-rule file is empty: ${normalized}.` });
  }

  return result;
}

export function ensureWikiPromptRuleScaffolds({ projectRoot }) {
  const root = path.resolve(projectRoot);
  const wikiRoot = path.join(root, WIKI_DIR);
  let config;
  try {
    config = readPolicyDomainConfig(root);
    if (config) safePolicyTarget(root, `${WIKI_DIR}/${WIKI_RULE_BASENAME}`, true);
  } catch {
    // Do not silently fall back to legacy scaffolds for invalid opt-in configuration.
    // Update can still run to repair it; discovery/finalization reports the error.
    return { created: [], sections: [], mode: "invalid" };
  }
  fs.mkdirSync(wikiRoot, { recursive: true });
  const sections = config ? [WIKI_DIR, ...config.domains.map((domain) => path.posix.dirname(domain.rule))].sort(compareRulePaths)
    : discoverWikiSectionPaths({ projectRoot: root });
  const created = [];
  if (config) {
    try { for (const section of sections) safePolicyTarget(root, `${section}/${WIKI_RULE_BASENAME}`, true); }
    catch { return { created, sections, mode: "invalid" }; }
  }
  for (const section of sections) {
    const rulePath = `${section}/${WIKI_RULE_BASENAME}`;
    // Preserve legacy treatment of pre-existing rule aliases; domain mode is stricter.
    if (!config && fs.existsSync(path.join(root, rulePath))) continue;
    const target = safePolicyTarget(root, rulePath, true);
    if (target.exists) continue;
    fs.mkdirSync(path.dirname(target.absolute), { recursive: true });
    const fresh = safePolicyTarget(root, rulePath, true);
    try { fs.writeFileSync(fresh.absolute, renderPromptRuleScaffold(section), { encoding: "utf8", flag: "wx" }); }
    catch (error) { if (error.code === "EEXIST") { safePolicyTarget(root, rulePath); continue; } throw error; }
    created.push(rulePath);
  }
  return { created, sections, mode: config ? "domains" : "legacy" };
}

export function discoverWikiSectionPaths({ projectRoot }) {
  const root = path.resolve(projectRoot);
  const wikiRoot = path.join(root, WIKI_DIR);
  const sections = new Set([WIKI_DIR]);
  if (!fs.existsSync(wikiRoot)) return [...sections];
  discoverSectionDirectories(wikiRoot, WIKI_DIR, sections);
  return [...sections].sort(compareRulePaths);
}

export function renderPromptRuleScaffold(sectionPath) {
  if (sectionPath === WIKI_DIR) {
    return [
      "# Global Wiki rules",
      "",
      "Load these rules only before editing a governed repository component. Do not load rules for read-only questions or unrelated work.",
      "",
      "Use `wiki/quickstart.md` to identify only the section rule files applicable to the edit. If applicable rules conflict, stop and report the conflict.",
      "",
      "No global rules have been added yet.",
      "",
    ].join("\n");
  }

  const section = sectionPath.slice(`${WIKI_DIR}/`.length);
  const title = section.split("/").at(-1).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return [
    `# ${title} rules`,
    "",
    `Load these rules only before editing components governed by the \`${sectionPath}/\` domain.`,
    "",
    "No domain-specific rules have been added yet.",
    "",
  ].join("\n");
}

function walkWikiDirectory({ root, absoluteDir, relativeDir, sectionPaths, report, includePath }) {
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const hasDocumentationPage = entries.some((entry) => entry.isFile() && isFinalDocumentationPage(entry.name)
    && (!includePath || includePath(`${relativeDir}/${entry.name}`, false)));
  if (relativeDir !== WIKI_DIR && hasDocumentationPage) sectionPaths.add(normalizeRepositoryPath(relativeDir));

  for (const entry of entries) {
    const relativePath = normalizeRepositoryPath(`${relativeDir}/${entry.name}`);
    const absolutePath = path.join(absoluteDir, entry.name);
    if (includePath && !includePath(relativePath, entry.isDirectory())) continue;
    if (entry.isSymbolicLink()) {
      if (entry.name === WIKI_RULE_BASENAME) report.files.push(relativePath);
      else report.warnings.push({ path: relativePath, code: "symlink_skipped", message: `Skipping Wiki symlink during discovery: ${relativePath}.` });
      continue;
    }
    if (entry.isDirectory()) {
      if (shouldSkipSectionDirectory(entry.name)) continue;
      walkWikiDirectory({ root, absoluteDir: absolutePath, relativeDir: relativePath, sectionPaths, report, includePath });
      continue;
    }
    if (entry.isFile() && entry.name === WIKI_RULE_BASENAME) report.files.push(relativePath);
  }
}

function discoverSectionDirectories(absoluteDir, relativeDir, sections) {
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  if (relativeDir !== WIKI_DIR && entries.some((entry) => entry.isFile() && isFinalDocumentationPage(entry.name))) {
    sections.add(normalizeRepositoryPath(relativeDir));
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || shouldSkipSectionDirectory(entry.name)) continue;
    discoverSectionDirectories(path.join(absoluteDir, entry.name), `${relativeDir}/${entry.name}`, sections);
  }
}

function isFinalDocumentationPage(name) {
  return name.endsWith(".md")
    && name !== WIKI_RULE_BASENAME
    && name !== "INSTRUCTIONS.md"
    && name !== "_plan.md"
    && !name.startsWith(".");
}

function shouldSkipSectionDirectory(name) {
  return name.startsWith(".") || name.startsWith("_") || SKIPPED_SECTION_DIRS.has(name);
}

function compareRulePaths(left, right) {
  if (left === right) return 0;
  if (left === WIKI_DIR || left === `${WIKI_DIR}/${WIKI_RULE_BASENAME}`) return -1;
  if (right === WIKI_DIR || right === `${WIKI_DIR}/${WIKI_RULE_BASENAME}`) return 1;
  return left.localeCompare(right);
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
