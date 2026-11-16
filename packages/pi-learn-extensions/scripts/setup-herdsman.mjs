#!/usr/bin/env node
// Explicit, local configuration setup only. Never imported by a Pi extension.
import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMap, parseDocument, visit } from "yaml";

const PACKAGE_DIR = new URL("../", import.meta.url);
const PROFILE_DIR = new URL("profiles/herdsman/", PACKAGE_DIR);
const BEGIN = "<!-- pi-learn:local-source-delegation:start -->";
const END = "<!-- pi-learn:local-source-delegation:end -->";
const MAX_BYTES = 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function expandDirectory(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Directory must not be empty.");
  if (value.startsWith("file://")) value = fileURLToPath(value);
  if (value === "~") value = homedir();
  else if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) value = path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

function info(file) {
  try { return lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

// Includes existing ancestors and dangling links. This is preflight, not an OS sandbox.
function safePath(file, directory = false) {
  const parent = path.dirname(file);
  if (parent !== file) safePath(parent, true);
  const stat = info(file);
  if (stat && (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()))) {
    throw new Error(`Unsafe ${directory ? "directory" : "file"}: ${file}; symlinks/nonregular targets are not supported.`);
  }
  if (stat && !directory && (stat.nlink !== 1 || stat.size > MAX_BYTES)) throw new Error(`Unsafe or oversized file: ${file}`);
  return stat;
}

function readTarget(file) {
  if (!safePath(file)) return null;
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error(`Unsafe file: ${file}`);
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_BYTES || bytes.includes(0)) throw new Error(`Invalid text: ${file}`);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { closeSync(fd); }
}

function readObject(file) {
  const text = readTarget(file);
  const value = text === null ? {} : JSON.parse(text);
  if (!object(value)) throw new Error(`Expected a JSON object: ${file}`);
  return { text, value };
}

function frontmatter(text, name, file) {
  if (text === null) text = `---\nname: ${name}\n---\n`;
  const match = text.match(/^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Expected Markdown YAML frontmatter: ${file}`);
  const doc = parseDocument(match[2], { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) throw new Error(`Invalid YAML mapping: ${file}`);
  // Do not treat direct AST fields as effective policy in merge-bearing YAML.
  // Refuse rather than silently override a deny policy inherited via a merge.
  visit(doc, { Pair(_key, pair) {
    if (pair.key?.value === "<<" || pair.key?.tag === "tag:yaml.org,2002:merge") throw new Error(`YAML merge keys are not supported by setup: ${file}; flatten the definition first.`);
  } });
  if (doc.get("name") !== name) throw new Error(`Definition name must be ${name}: ${file}`);
  for (const legacy of ["max_turns", "inherit_project_context", "maxTurns"]) {
    if (doc.has(legacy)) throw new Error(`Unsupported legacy field ${legacy}: ${file}; migrate it before setup.`);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { text, doc, body: text.slice(match[0].length), bom: match[1], eol };
}

function arrayField(doc, field, file) {
  if (!doc.has(field)) return undefined;
  const value = doc.toJS({ maxAliasCount: 100 })[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be a YAML array: ${file}`);
  }
  return value;
}

// Herdsman normalizes tool selectors by splitting commas, trimming and dropping blanks.
const toolNames = (values = []) => values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);

function effectiveExclusions(inherited = [], overlay) {
  if (overlay === undefined) return toolNames(inherited);
  const modifiers = (entry) => entry.startsWith("+") || entry.startsWith("-");
  const plain = overlay.filter((entry) => !modifiers(entry));
  const result = plain.length || overlay.length === 0 ? Array.from(new Set(plain)) : inherited.slice();
  // For excludeTools, Herdsman composes raw array entries before comma normalization.
  for (const entry of overlay.filter(modifiers)) {
    const selector = entry.substring(1);
    const at = result.indexOf(selector);
    if (entry.startsWith("-")) { if (at !== -1) result.splice(at, 1); }
    else if (at === -1) result.push(selector);
  }
  return toolNames(result);
}

function addValues(doc, field, additions, inherited, file) {
  const original = arrayField(doc, field, file);
  const normalize = field === "tools" ? toolNames : (values) => values;
  const current = original && normalize(original);
  const values = original ? [...original] : [];
  if (field === "tools") {
    // Changing a tool policy whose base is unknown could broaden it accidentally.
    if (!current && !Array.isArray(inherited)) throw new Error(`Cannot determine inherited tools: ${file}`);
    if (current && current.length === 0) throw new Error(`Refusing to enable tools on an explicitly empty policy: ${file}`);
  }
  for (const addition of additions) {
    if (current?.includes(`-${addition}`)) throw new Error(`Explicit ${field} removal conflicts with profile (${addition}): ${file}`);
  }
  const effectiveBase = !current || current.every((item) => /^[+-]/.test(item)) ? normalize(inherited ?? []) : [];
  for (const addition of additions) {
    if (!current?.includes(addition) && !current?.includes(`+${addition}`) && !effectiveBase.includes(addition)) values.push(`+${addition}`);
  }
  if (values.length !== (original?.length ?? 0)) doc.set(field, values);
}

function renderMarkdown(parsed, body = parsed.body) {
  return `${parsed.bom}---${parsed.eol}${String(parsed.doc).replace(/\r?\n/g, parsed.eol)}---${parsed.eol}${body}`;
}

function leadBody(body, prompt, eol, file) {
  const normalized = prompt.trim().replace(/\r?\n/g, eol);
  const managed = `${BEGIN}${eol}${normalized}${eol}${END}`;
  const starts = body.split(BEGIN).length - 1;
  const ends = body.split(END).length - 1;
  if (starts || ends) {
    if (starts !== 1 || ends !== 1 || body.indexOf(END) < body.indexOf(BEGIN)) throw new Error(`Malformed managed prompt block: ${file}`);
    return body.slice(0, body.indexOf(BEGIN)) + managed + body.slice(body.indexOf(END) + END.length);
  }
  // Adopt the exact unmarked prompt used before this profile was checked in.
  if (body.trim().replace(/\r\n/g, "\n") === prompt.trim().replace(/\r\n/g, "\n")) return `${eol}${managed}${eol}`;
  return body + (body ? (body.endsWith(eol + eol) ? "" : body.endsWith(eol) ? eol : eol + eol) : eol) + managed + eol;
}

function packageRoot(name, agentDir, packagesDir) {
  const candidates = packagesDir ? [path.join(packagesDir, name)] : [path.join(agentDir, "npm", "node_modules", name)];
  for (const root of candidates) {
    const manifest = path.join(root, "package.json");
    if (info(manifest)) {
      const data = JSON.parse(readFileSync(manifest, "utf8"));
      if (data.name !== name) throw new Error(`Unexpected package identity: ${manifest}`);
      return realpathSync(root);
    }
  }
  throw new Error(`Missing ${name}. Install with \`pi install npm:${name}\` first, or pass --packages-dir <node_modules>.`);
}

export function planSetup({ agentDir, packagesDir } = {}) {
  agentDir = expandDirectory(agentDir ?? (process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent")));
  if (packagesDir !== undefined) packagesDir = expandDirectory(packagesDir);
  safePath(agentDir, true);
  const profile = JSON.parse(readFileSync(new URL("profile.json", PROFILE_DIR), "utf8"));
  const prompt = readFileSync(new URL("flexible-lead.md", PROFILE_DIR), "utf8");
  const herdRoot = packageRoot("pi-herdsman", agentDir, packagesDir);
  const extensions = profile.extensions.map((resource) => {
    // ./ resources belong to this Pi Learn package, not the external npm lookup.
    // Anchor to the script so checkout and Git-installed copies resolve identically.
    const [name, ...relative] = resource.split("/");
    const entry = resource.startsWith("./")
      ? path.join(realpathSync(fileURLToPath(PACKAGE_DIR)), resource)
      : path.join(packageRoot(name, agentDir, packagesDir), ...relative);
    if (!info(entry)?.isFile()) throw new Error(`Missing extension entry: ${entry}`);
    return entry;
  });
  const plan = [];
  const configFile = path.join(agentDir, "pi-herdsman", "config.json");
  const config = readObject(configFile);
  const configNext = { ...config.value, ...profile.config };
  plan.push({ path: configFile, before: config.text, after: JSON.stringify(configNext, null, 2) + "\n" });
  for (const name of profile.agents) {
    const file = path.join(agentDir, "agents", `${name}.md`);
    const before = readTarget(file);
    const parsed = frontmatter(before, name, file);
    const bundled = path.join(herdRoot, "dist", "agents", `${name}.md`);
    const base = frontmatter(readFileSync(bundled, "utf8"), name, bundled).doc;
    const exclusions = effectiveExclusions(arrayField(base, "excludeTools", bundled), arrayField(parsed.doc, "excludeTools", file));
    if (exclusions.some((pattern) => profile.tools.some((tool) => new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(tool)))) {
      throw new Error(`excludeTools conflicts with web tools: ${file}`);
    }
    const noTools = parsed.doc.has("noTools") ? parsed.doc.toJS({ maxAliasCount: 100 }).noTools : base.toJS({ maxAliasCount: 100 }).noTools;
    if (noTools === true) throw new Error(`Refusing to override noTools: true: ${file}`);
    addValues(parsed.doc, "extensions", extensions, arrayField(base, "extensions", bundled), file);
    addValues(parsed.doc, "tools", profile.tools, arrayField(base, "tools", bundled), file);
    plan.push({ path: file, before, after: renderMarkdown(parsed) });
  }
  const leadFile = path.join(agentDir, "coordinators", "flexible-lead.md");
  const before = readTarget(leadFile);
  const parsed = frontmatter(before, "flexible-lead", leadFile);
  if (!parsed.doc.has("bodyMode")) parsed.doc.set("bodyMode", "append");
  else if (!["append", "replace"].includes(parsed.doc.get("bodyMode"))) throw new Error(`Invalid bodyMode: ${leadFile}`);
  plan.push({ path: leadFile, before, after: renderMarkdown(parsed, leadBody(parsed.body, prompt, parsed.eol, leadFile)) });
  // Preserve JSON formatting as well as mtime when the configured value is already correct.
  if (JSON.stringify(config.value) === JSON.stringify(configNext)) plan[0].after = config.text;
  return { agentDir, plan };
}

export function applySetup({ plan }, { dryRun = false } = {}) {
  // Preflight every target and check for changes since planning before the first write.
  for (const item of plan) if (readTarget(item.path) !== item.before) throw new Error(`Config changed during setup: ${item.path}`);
  const changed = plan.filter((item) => item.before !== item.after);
  if (!dryRun) {
    for (const item of changed) {
      safePath(item.path);
      if (readTarget(item.path) !== item.before) throw new Error(`Config changed during setup: ${item.path}`);
      mkdirSync(path.dirname(item.path), { recursive: true, mode: 0o700 });
      const temp = path.join(path.dirname(item.path), `.pi-learn-${randomUUID()}.tmp`);
      const mode = info(item.path)?.mode & 0o777;
      try {
        writeFileSync(temp, item.after, { flag: "wx", mode: mode || 0o600 });
        // Recheck before replacement. External writers can still race this check.
        if (readTarget(item.path) !== item.before) throw new Error(`Config changed during setup: ${item.path}`);
        renameSync(temp, item.path);
      } finally { if (info(temp)) unlinkSync(temp); }
    }
  }
  return changed.map((item) => item.path);
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: setup-herdsman.mjs [--dry-run] [--agent-dir <dir>] [--packages-dir <node_modules>]\nApplies the checked-in Pi Learn Herdsman profile. Install pi-herdsman, pi-tool-display and pi-web-access first. No installs, credentials, or Pi settings are read/changed.");
      return;
    }
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--agent-dir" || arg === "--packages-dir") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg === "--agent-dir" ? "agentDir" : "packagesDir"] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const setup = planSetup(options);
  const changed = applySetup(setup, options);
  for (const file of changed) console.log(`${options.dryRun ? "Would update" : "Updated"}: ${file}`);
  console.log(changed.length ? `${options.dryRun ? "Planned" : "Applied"} ${changed.length} file(s).` : "Profile already applied; no writes.");
  if (!options.dryRun) console.log("Reload/restart the parent Pi. New child launches use the overrides; running children are unchanged. Project/private overlays can still override global definitions.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`Herdsman setup failed: ${error.message}`); process.exitCode = 1; }
}
