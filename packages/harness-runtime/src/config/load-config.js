import fs from "node:fs";
import path from "node:path";
import { resolveProject } from "../project/resolve-project.js";
import { expandHome, pathExists, resolvePath } from "../utils/path.js";

export const builtInDefaults = Object.freeze({
  schemaVersion: 1,
  sessionDir: "~/.pi/agent/sessions",
  harnessHome: "~/.pi/harness",
  projectCwd: process.cwd(),
  redact: true,
  maxSessionsPerScan: 50,
  activePathOnly: true,
  autoApply: false,
  autoPush: false,
  automation: {
    enabled: false,
    maxSessions: 5,
    scan: true,
    report: true,
    proposeRules: true,
    proposeTargets: ["memory", "parser", "redaction"],
    eval: true,
    createEvalFixtureDraft: true,
  },
  targets: {
    agents: true,
    memory: true,
    rules: true,
    skills: true,
    prompts: true,
    extensions: true,
    parser: true,
    redaction: true,
    settings: false,
  },
  riskPolicy: {
    lowRiskAutoPatch: false,
    requireHumanApproval: true,
    requireGitClean: true,
  },
  logging: {
    enabled: true,
    level: "info",
    logDir: undefined,
    runtime: true,
    audit: true,
    errors: true,
    selfImprovement: true,
    console: false,
    redact: true,
    includeStack: true,
  },
});

export function loadConfig(options = {}) {
  const globalConfigPath = resolvePath(options.globalConfig ?? "~/.pi/harness/config.json");
  const globalConfig = readJsonIfExists(globalConfigPath) ?? {};

  const initial = deepMerge(builtInDefaults, globalConfig);
  const projectCwd = options.project ?? initial.projectCwd ?? process.cwd();
  const project = resolveProject(projectCwd);

  const projectConfigPath = options.projectConfig
    ? resolvePath(options.projectConfig)
    : path.join(project.projectRoot, "harness", "config.json");
  const projectConfig = readJsonIfExists(projectConfigPath) ?? {};

  const cliOverrides = buildCliOverrides(options);
  const merged = deepMerge(initial, projectConfig, cliOverrides);

  const resolvedHarnessHome = resolvePath(merged.harnessHome);
  const config = {
    ...merged,
    sessionDir: resolvePath(merged.sessionDir),
    harnessHome: resolvedHarnessHome,
    projectCwd: project.cwd,
    logging: {
      ...merged.logging,
      logDir: merged.logging?.logDir ? resolvePath(merged.logging.logDir) : path.join(resolvedHarnessHome, "logs"),
    },
  };

  return {
    config,
    project,
    sources: {
      builtInDefaults: true,
      globalConfigPath,
      globalConfigFound: pathExists(globalConfigPath),
      projectConfigPath,
      projectConfigFound: pathExists(projectConfigPath),
    },
  };
}

export function readJsonIfExists(filePath) {
  if (!pathExists(filePath)) return undefined;
  const text = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON config at ${filePath}: ${error.message}`);
  }
}

export function deepMerge(...objects) {
  const result = {};
  for (const object of objects) {
    mergeInto(result, object ?? {});
  }
  return result;
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
    } else if (isPlainObject(value)) {
      target[key] = deepMerge(value);
    } else {
      target[key] = value;
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildCliOverrides(options) {
  const overrides = {};
  if (options.sessionDir) overrides.sessionDir = expandHome(options.sessionDir);
  if (options.harnessHome) overrides.harnessHome = expandHome(options.harnessHome);
  if (typeof options.redact === "boolean") overrides.redact = options.redact;
  if (typeof options.maxSessionsPerScan === "number") overrides.maxSessionsPerScan = options.maxSessionsPerScan;
  if (typeof options.activePathOnly === "boolean") overrides.activePathOnly = options.activePathOnly;
  return overrides;
}
