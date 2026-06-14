#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config/load-config.js";
import { checkWritableDirectory, ensureHarnessHome, projectCacheDir } from "./storage/harness-home.js";
import { writeSessionCache } from "./storage/cache-writer.js";
import { discoverSessions } from "./session/discover-sessions.js";
import { createLogger } from "./logging/logger.js";
import { parseSessionFile, summarizeEntry } from "./session/parse-session.js";
import { buildSessionTree, renderTreeText, summarizeTree } from "./session/tree.js";
import { pathExists, resolvePath } from "./utils/path.js";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const VERSION = packageJson.version;

async function main(argv) {
  const { command, rest, options } = parseArgs(argv);

  if (options.version) {
    console.log(VERSION);
    return;
  }

  if (options.help || !command) {
    printHelp();
    return;
  }

  switch (command) {
    case "doctor":
      return commandDoctor(options);
    case "config":
      return commandConfig(rest, options);
    case "project":
      return commandProject(rest, options);
    case "sessions":
      return commandSessions(options);
    case "scan":
      return commandScan(options);
    case "inspect":
      return commandInspect(rest, options);
    default:
      throw new CliError(`Unknown command: ${command}`, 2);
  }
}

function commandDoctor(options) {
  const { config, project, sources, logger } = createCommandContext("doctor", options);
  let result;

  try {
    const harnessHome = ensureHarnessHome(config);
    const sessionDirExists = pathExists(config.sessionDir);
    let harnessHomeWritable = false;
    let harnessHomeError;

    try {
      harnessHomeWritable = checkWritableDirectory(harnessHome);
    } catch (error) {
      harnessHomeError = error.message;
      logger.warn("doctor_probe_failed", "Harness home writable probe failed", {
        component: "storage",
        projectKey: project.projectKey,
        data: { harnessHome, error: error.message },
      });
    }

    result = {
      ok: Boolean(sessionDirExists && harnessHomeWritable),
      version: VERSION,
      config: publicConfigSummary(config),
      project,
      cache: {
        harnessHome,
        projectCacheDir: projectCacheDir(harnessHome, project.projectKey),
        sessionDirExists,
        harnessHomeWritable,
        harnessHomeError,
      },
      sources,
    };

    logger.info("doctor_completed", "Doctor checks completed", {
      component: "cli",
      projectKey: project.projectKey,
      data: { ok: result.ok, sessionDirExists, harnessHomeWritable },
    });
    logger.info("command_end", "Command finished", { component: "cli", projectKey: project.projectKey, data: { ok: result.ok } });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Harness doctor");
  console.log("--------------");
  console.log(`Version:              ${VERSION}`);
  console.log(`Project cwd:          ${project.cwd}`);
  console.log(`Project root:         ${project.projectRoot}`);
  console.log(`Git root:             ${project.gitRoot ?? "(none)"}`);
  console.log(`Project key:          ${project.projectKey}`);
  console.log(`Session dir:          ${config.sessionDir}`);
  console.log(`Session dir exists:   ${result.cache.sessionDirExists ? "yes" : "no"}`);
  console.log(`Harness home:         ${result.cache.harnessHome}`);
  console.log(`Harness home writable:${result.cache.harnessHomeWritable ? " yes" : " no"}`);
  if (result.cache.harnessHomeError) console.log(`Harness home error:   ${result.cache.harnessHomeError}`);
  console.log(`Global config:        ${sources.globalConfigFound ? sources.globalConfigPath : "(not found)"}`);
  console.log(`Project config:       ${sources.projectConfigFound ? sources.projectConfigPath : "(not found)"}`);
  console.log("Redaction module:     minimal cache/log redaction enabled");

  if (!result.ok) process.exitCode = 1;
}

function commandConfig(rest, options) {
  const subcommand = rest[0];
  if (subcommand !== "print") {
    throw new CliError("Usage: harness config print [--project <path>] [--json]", 2);
  }

  const { config, project, sources, logger } = createCommandContext("config print", options);
  logger.info("command_end", "Command finished", { component: "cli", projectKey: project.projectKey, data: { printed: "config" } });
  console.log(JSON.stringify({ config, project, sources }, null, 2));
}

function commandProject(rest, options) {
  const subcommand = rest[0];
  if (subcommand !== "resolve") {
    throw new CliError("Usage: harness project resolve --project <path> [--json]", 2);
  }

  const { project, logger } = createCommandContext("project resolve", options);
  logger.info("command_end", "Command finished", { component: "cli", projectKey: project.projectKey, data: { resolved: true } });

  if (options.json) {
    console.log(JSON.stringify(project, null, 2));
    return;
  }

  console.log(`cwd:         ${project.cwd}`);
  console.log(`projectRoot: ${project.projectRoot}`);
  console.log(`gitRoot:     ${project.gitRoot ?? "(none)"}`);
  console.log(`projectKey:  ${project.projectKey}`);
  console.log(`name:        ${project.name}`);
}

async function commandScan(options) {
  const { config, project, sources, logger } = createCommandContext("scan", options);
  ensureHarnessHome(config);

  let discovery;
  const results = [];
  try {
    discovery = runSessionDiscovery({ config, project, logger });

    for (const session of discovery.sessions) {
      results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    }

    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { sessionsCached: results.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = {
    project,
    sessionDir: config.sessionDir,
    scannedFiles: discovery.scannedFiles ?? 0,
    count: results.length,
    results: results.map((result) => ({
      sessionId: result.sessionId,
      sessionFile: result.sessionFile,
      outDir: result.outDir,
      eventCount: result.eventCount,
      warningsCount: result.warnings.length,
      metrics: result.metrics,
    })),
    warnings: discovery.warnings,
    sources,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Scan project: ${project.projectKey}`);
  console.log(`Scanned files: ${output.scannedFiles}`);
  console.log(`Cached sessions: ${output.count}`);
  for (const result of results) {
    console.log(`- ${result.sessionId ?? "(no id)"}`);
    console.log(`  out: ${result.outDir}`);
    console.log(`  events=${result.eventCount} warnings=${result.warnings.length}`);
  }
}

function commandSessions(options) {
  const { config, project, sources, logger } = createCommandContext("sessions", options);
  let result;

  try {
    result = runSessionDiscovery({ config, project, logger });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { sessions: result.sessions.length, warnings: result.warnings.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = {
    project,
    sessionDir: config.sessionDir,
    scannedFiles: result.scannedFiles ?? 0,
    count: result.sessions.length,
    sessions: result.sessions,
    warnings: result.warnings,
    sources,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Sessions for ${project.projectKey}`);
  console.log(`Project root: ${project.projectRoot}`);
  console.log(`Session dir:  ${config.sessionDir}`);
  console.log(`Scanned files: ${output.scannedFiles}`);
  console.log(`Matched:       ${output.count}`);
  if (result.warnings.length) console.log(`Warnings:      ${result.warnings.length}`);
  console.log("");

  if (!result.sessions.length) {
    console.log("No sessions found for project.");
    return;
  }

  for (const session of result.sessions) {
    console.log(`${session.timestamp ?? session.mtime}  ${session.sessionId ?? "(no id)"}`);
    console.log(`  file: ${session.sessionFile}`);
    console.log(`  cwd:  ${session.cwd ?? "(unknown)"}`);
    console.log(`  v${session.piSessionVersion} size=${session.size}`);
  }
}

async function commandInspect(rest, options) {
  const sessionFile = rest[0] ? resolvePath(rest[0]) : undefined;
  if (!sessionFile) {
    throw new CliError("Usage: harness inspect <session.jsonl> [--tree] [--active-path] [--json]", 2);
  }

  const { project, logger } = createCommandContext("inspect", options);
  let parsed;
  let tree;
  let warnings;
  let activePathEntries;

  try {
    logger.info("parse_start", "Parsing session JSONL", {
      component: "parser",
      projectKey: project.projectKey,
      sessionFile,
    });

    try {
      parsed = await parseSessionFile(sessionFile);
    } catch (error) {
      throw toSessionFileCliError(error, sessionFile);
    }

    tree = buildSessionTree(parsed.entries, sessionFile);
    warnings = [...parsed.warnings, ...tree.warnings];
    activePathEntries = tree.activePathEntryIds
      .map((entryId) => tree.entryMap.get(entryId))
      .filter(Boolean)
      .map(summarizeEntry);

    logger.info("parse_end", "Parsed session JSONL", {
      component: "parser",
      projectKey: project.projectKey,
      sessionId: parsed.header?.id,
      sessionFile,
      data: { entries: parsed.entries.length, warnings: warnings.length },
    });
    logger.info("tree_built", "Session tree built", {
      component: "tree",
      projectKey: project.projectKey,
      sessionId: parsed.header?.id,
      sessionFile,
      data: { activeLeafId: tree.activeLeafId, activePathCount: tree.activePathEntryIds.length, branchCount: tree.branchCount },
    });
    logger.info("active_path_resolved", "Active path resolved", {
      component: "tree",
      projectKey: project.projectKey,
      sessionId: parsed.header?.id,
      sessionFile,
      data: { activePathCount: tree.activePathEntryIds.length },
    });
    for (const warning of warnings) {
      logger.warn("parse_warning", warning.message, {
        component: "parser",
        projectKey: project.projectKey,
        sessionId: parsed.header?.id,
        sessionFile,
        entryId: warning.entryId,
        data: { code: warning.code, lineNumber: warning.lineNumber },
      });
    }
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { inspected: sessionFile, warnings: warnings.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = {
    sessionFile,
    header: parsed.header,
    stats: parsed.stats,
    entryCount: parsed.entries.length,
    tree: summarizeTree(tree, parsed.entries),
    activePath: activePathEntries,
    warnings,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log("Session inspect");
  console.log("---------------");
  console.log(`File:          ${sessionFile}`);
  console.log(`Session id:    ${parsed.header?.id ?? "(missing)"}`);
  console.log(`Version:       ${parsed.header?.version ?? "(unknown)"}`);
  console.log(`CWD:           ${parsed.header?.cwd ?? "(unknown)"}`);
  console.log(`Entries:       ${parsed.entries.length}`);
  console.log(`Active leaf:   ${tree.activeLeafId ?? "(none)"}`);
  console.log(`Active path:   ${tree.activePathEntryIds.length}`);
  console.log(`Branches:      ${tree.branchCount}`);
  console.log(`Warnings:      ${warnings.length}`);

  if (options.tree) {
    console.log("\nTree (* = active path)");
    console.log(renderTreeText(tree) || "(empty)");
  }

  if (options.activePath) {
    console.log("\nActive path");
    for (const entry of activePathEntries) {
      console.log(formatSummaryLine(entry));
    }
  }
}

function createCommandContext(command, options) {
  const { config, project, sources } = loadConfig(options);
  const logger = createLogger({ config, command, project });

  logger.info("command_start", "Command started", {
    component: "cli",
    projectKey: project.projectKey,
    data: { command, options: safeOptionSummary(options) },
  });
  logger.info("config_loaded", "Config loaded", {
    component: "config",
    projectKey: project.projectKey,
    data: {
      globalConfigFound: sources.globalConfigFound,
      projectConfigFound: sources.projectConfigFound,
      config: publicConfigSummary(config),
    },
  });
  logger.info("project_resolved", "Project resolved", {
    component: "project",
    projectKey: project.projectKey,
    data: project,
  });

  return { config, project, sources, logger };
}

function runSessionDiscovery({ config, project, logger }) {
  logger.info("session_discovery_start", "Session discovery started", {
    component: "session_discovery",
    projectKey: project.projectKey,
    data: { sessionDir: config.sessionDir, maxSessionsPerScan: config.maxSessionsPerScan },
  });

  const result = discoverSessions(config, project, {
    maxSessions: config.maxSessionsPerScan,
  });

  for (const session of result.sessions) {
    logger.info("session_discovered", "Session header matched project", {
      component: "session_discovery",
      projectKey: project.projectKey,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      data: {
        cwd: session.cwd,
        piSessionVersion: session.piSessionVersion,
        size: session.size,
        mtimeMs: session.mtimeMs,
      },
    });
  }
  for (const warning of result.warnings) {
    logger.warn("session_discovery_warning", warning.message, {
      component: "session_discovery",
      projectKey: project.projectKey,
      sessionFile: warning.sessionFile,
      data: { code: warning.code },
    });
  }

  logger.info("session_discovery_end", "Session discovery finished", {
    component: "session_discovery",
    projectKey: project.projectKey,
    data: { scannedFiles: result.scannedFiles ?? 0, matched: result.sessions.length, warnings: result.warnings.length },
  });

  return result;
}

function logCommandFailure(logger, project, error) {
  logger.error("command_failed", error.message, {
    component: "cli",
    projectKey: project.projectKey,
    data: { name: error.name, exitCode: error.exitCode, stack: error.stack },
  });
}

function publicConfigSummary(config) {
  return {
    sessionDir: config.sessionDir,
    harnessHome: config.harnessHome,
    projectCwd: config.projectCwd,
    redact: config.redact,
    activePathOnly: config.activePathOnly,
    maxSessionsPerScan: config.maxSessionsPerScan,
    autoApply: config.autoApply,
    autoPush: config.autoPush,
    logging: {
      enabled: config.logging?.enabled,
      level: config.logging?.level,
      logDir: config.logging?.logDir,
      console: config.logging?.console,
    },
  };
}

function safeOptionSummary(options) {
  return {
    json: Boolean(options.json),
    project: options.project,
    sessionDir: options.sessionDir,
    harnessHome: options.harnessHome,
    maxSessionsPerScan: options.maxSessionsPerScan,
    activePathOnly: options.activePathOnly,
    tree: Boolean(options.tree),
    activePath: Boolean(options.activePath),
  };
}

function toSessionFileCliError(error, sessionFile) {
  if (error?.code === "ENOENT") return new CliError(`Session file not found: ${sessionFile}`, 2);
  if (error?.code === "EACCES") return new CliError(`Permission denied reading session file: ${sessionFile}`, 2);
  if (error?.code === "EISDIR") return new CliError(`Expected session file but got directory: ${sessionFile}`, 2);
  return error;
}

function formatSummaryLine(entry) {
  const bits = [entry.id, entry.type];
  if (entry.role) bits.push(entry.role);
  if (entry.toolName) bits.push(entry.toolName);
  if (entry.toolCalls) bits.push(`toolCalls=${entry.toolCalls}`);
  if (entry.timestamp) bits.push(entry.timestamp);
  return bits.filter(Boolean).join("  ");
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--project":
      case "-p":
        options.project = requireValue(args, ++i, arg);
        break;
      case "--session-dir":
        options.sessionDir = requireValue(args, ++i, arg);
        break;
      case "--harness-home":
        options.harnessHome = requireValue(args, ++i, arg);
        break;
      case "--global-config":
        options.globalConfig = requireValue(args, ++i, arg);
        break;
      case "--project-config":
        options.projectConfig = requireValue(args, ++i, arg);
        break;
      case "--redact":
        options.redact = true;
        break;
      case "--no-redact":
        options.redact = false;
        break;
      case "--active-path-only":
        options.activePathOnly = true;
        break;
      case "--all-branches":
        options.activePathOnly = false;
        break;
      case "--tree":
        options.tree = true;
        break;
      case "--active-path":
        options.activePath = true;
        break;
      case "--last":
        options.maxSessionsPerScan = Number(requireValue(args, ++i, arg));
        if (!Number.isFinite(options.maxSessionsPerScan)) {
          throw new CliError(`Invalid number for ${arg}`, 2);
        }
        break;
      default:
        if (arg.startsWith("-")) throw new CliError(`Unknown option: ${arg}`, 2);
        positional.push(arg);
    }
  }

  return {
    command: positional[0],
    rest: positional.slice(1),
    options,
  };
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("-")) throw new CliError(`Missing value for ${flag}`, 2);
  return value;
}

function printHelp() {
  const script = path.relative(process.cwd(), fs.realpathSync(process.argv[1]));
  console.log(`Harness runtime ${VERSION}

Usage:
  harness doctor [--project <path>] [--json]
  harness config print [--project <path>]
  harness project resolve --project <path> [--json]
  harness sessions [--project <path>] [--last <n>] [--json]
  harness scan [--project <path>] [--last <n>] [--json]
  harness inspect <session.jsonl> [--tree] [--active-path] [--json]

Options:
  -p, --project <path>       Project cwd to resolve
      --session-dir <path>   Override Pi session directory
      --harness-home <path>  Override private harness cache home
      --global-config <path> Override global config path
      --project-config <path> Override project config path
      --json                 Print JSON when supported
      --redact               Enable redaction for cache/log outputs (default)
      --no-redact            Reserved; cache/log outputs remain redacted for safety
      --active-path-only     Reserved for scan/report branch mode; currently config only
      --all-branches         Reserved for scan/report branch mode; currently config only
      --last <n>             Max sessions per scan/report
      --tree                 Print session tree for inspect
      --active-path          Print active path for inspect
  -h, --help                 Show help
  -v, --version              Show version

Direct run:
  node ${script} doctor --project .
`);
}

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

main(process.argv.slice(2)).catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error(error.stack || error.message);
  process.exit(1);
});
