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
import { collectNormalizeWarnings, enrichWarnings } from "./session/warnings.js";
import { contentToText, makeExcerpt } from "./normalize/content.js";
import { redactValue } from "./safety/redaction.js";
import { generateProjectReport, writeProjectReport } from "./report/report.js";
import { buildReflection, reflectionResponseToProposals, writeReflectionPrompt } from "./reflection/reflection.js";
import { runRuleEngine } from "./analysis/rules.js";
import { generateTargetedImprovements } from "./improve/target-proposals.js";
import { writeMemoryDrafts } from "./memory/memory-drafts.js";
import { findDraftProposal, readDraftProposals, writeDraftProposals } from "./proposals/proposal-writer.js";
import { approveProposal, applyProposal, readProposalHistory, rejectProposal, rollbackProposal } from "./proposals/lifecycle.js";
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
    case "report":
      return commandReport(options);
    case "reflect":
      return commandReflect(options);
    case "propose":
      return commandPropose(options);
    case "proposals":
      return commandProposals(options);
    case "show":
      return commandShow(rest, options);
    case "approve":
      return commandApprove(rest, options);
    case "reject":
      return commandReject(rest, options);
    case "apply":
      return commandApply(rest, options);
    case "rollback":
      return commandRollback(rest, options);
    case "history":
      return commandHistory(rest, options);
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
      warnings: result.warnings,
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

async function commandReport(options) {
  const { config, project, sources, logger } = createCommandContext("report", options);
  ensureHarnessHome(config);

  let discovery;
  const results = [];
  let reportPaths;
  let markdown;

  try {
    discovery = runSessionDiscovery({ config, project, logger });

    for (const session of discovery.sessions) {
      results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    }

    logger.info("report_generate_start", "Generating Markdown report", {
      component: "report",
      projectKey: project.projectKey,
      data: { sessions: results.length },
    });

    const now = new Date();
    markdown = generateProjectReport({ project, results, generatedAt: now });
    reportPaths = writeProjectReport({ config, project, markdown, now });

    logger.info("report_generated", "Markdown report generated", {
      component: "report",
      projectKey: project.projectKey,
      data: { latestPath: reportPaths.latestPath, datedPath: reportPaths.datedPath, sessions: results.length },
    });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { sessionsReported: results.length, reportPath: reportPaths.latestPath },
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
    report: reportPaths,
    results: results.map((result) => ({
      sessionId: result.sessionId,
      sessionFile: result.sessionFile,
      outDir: result.outDir,
      eventCount: result.eventCount,
      warningsCount: result.warnings.length,
      warnings: result.warnings,
      metrics: result.metrics,
    })),
    warnings: discovery.warnings,
    sources,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Report project: ${project.projectKey}`);
  console.log(`Scanned files: ${output.scannedFiles}`);
  console.log(`Sessions reported: ${output.count}`);
  console.log(`Latest report: ${reportPaths.latestPath}`);
  console.log(`Dated report:  ${reportPaths.datedPath}`);
}

async function commandReflect(options) {
  const { config, project, sources, logger } = createCommandContext(options.proposeMode ? "propose --llm" : "reflect", options);
  ensureHarnessHome(config);

  if (options.importFile) return commandReflectImport({ config, project, sources, logger, options });

  let discovery;
  const results = [];
  let reflection;
  let reflectionPaths;

  try {
    discovery = runSessionDiscovery({ config, project, logger });
    for (const session of discovery.sessions) {
      results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    }

    logger.info("reflection_build_start", "Building LLM reflection prompt from normalized evidence", {
      component: "reflection",
      projectKey: project.projectKey,
      data: { sessions: results.length, maxEvents: options.maxEvents, maxExcerptChars: options.maxExcerptChars },
    });

    const now = new Date();
    reflection = buildReflection({
      project,
      sessionResults: results,
      generatedAt: now,
      maxEvents: options.maxEvents,
      maxExcerptChars: options.maxExcerptChars,
    });
    reflectionPaths = writeReflectionPrompt({ config, project, prompt: reflection.prompt, now });

    logger.info("reflection_prompt_written", "LLM reflection prompt written", {
      component: "reflection",
      projectKey: project.projectKey,
      data: { latestPath: reflectionPaths.latestPath, evidenceCount: reflection.evidence.length },
    });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { sessionsReflected: results.length, evidenceCount: reflection.evidence.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = {
    project,
    sessionDir: config.sessionDir,
    scannedFiles: discovery.scannedFiles ?? 0,
    sessionsScanned: results.length,
    mode: options.proposeMode ? "llm_reflection_prompt" : "reflect",
    reflection: reflectionPaths,
    evidenceCount: reflection.evidence.length,
    metrics: reflection.metrics,
    warnings: discovery.warnings,
    sources,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Reflect project: ${project.projectKey}`);
  console.log(`Mode: ${output.mode}`);
  console.log(`Scanned files: ${output.scannedFiles}`);
  console.log(`Sessions scanned: ${output.sessionsScanned}`);
  console.log(`Evidence items: ${output.evidenceCount}`);
  console.log(`Latest prompt: ${reflectionPaths.latestPath}`);
  console.log(`Dated prompt:  ${reflectionPaths.datedPath}`);
  if (options.proposeMode) {
    console.log("Note: --llm prepares a redacted reflection prompt. Use `/harness-reflect-pi` to run the current Pi session model, or import a reviewed JSON response with `harness reflect --import`.");
  }
}

function commandReflectImport({ config, project, sources, logger, options }) {
  const importPath = resolvePath(options.importFile);
  let proposals;
  let writeResult;
  try {
    const response = fs.readFileSync(importPath, "utf8");
    proposals = reflectionResponseToProposals({ response, project });
    writeResult = writeDraftProposals({ config, project, proposals });
    logger.audit("reflection_imported", "LLM reflection response imported as draft proposals", {
      component: "reflection",
      projectKey: project.projectKey,
      data: { importPath, candidates: proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length },
    });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { imported: importPath, candidates: proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = {
    project,
    mode: "reflect_import",
    importPath,
    candidates: proposals.length,
    draftDir: writeResult.draftDir,
    written: writeResult.written.map(publicProposalSummary),
    skipped: writeResult.skipped.map(publicProposalSummary),
    sources,
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`Imported LLM reflection: ${importPath}`);
  console.log(`Candidates: ${output.candidates}`);
  console.log(`Written: ${output.written.length}`);
  for (const proposal of output.written) console.log(`- ${proposal.id} ${proposal.title}`);
  if (output.skipped.length) console.log(`Skipped duplicates: ${output.skipped.length}`);
}

async function commandPropose(options) {
  if (options.llm) return commandReflect({ ...options, proposeMode: true });
  if (!options.rules && !options.target) {
    throw new CliError("Usage: harness propose (--rules | --target <memory|rules|parser|redaction> | --llm) [--project <path>] [--last <n>] [--json]", 2);
  }
  if (options.target && !["memory", "rules", "parser", "redaction"].includes(options.target)) {
    throw new CliError(`Unsupported propose target: ${options.target}`, 2);
  }

  const { config, project, sources, logger } = createCommandContext("propose", options);
  ensureHarnessHome(config);

  let discovery;
  const results = [];
  let proposals = [];
  let writeResult;
  let memoryWriteResult = { written: [] };

  try {
    discovery = runSessionDiscovery({ config, project, logger });
    for (const session of discovery.sessions) {
      results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    }

    logger.info("rule_engine_start", "Proposal generation started", {
      component: "rule_engine",
      projectKey: project.projectKey,
      data: { sessions: results.length, mode: options.target ? `target:${options.target}` : "rules" },
    });

    if (options.target) {
      const improvement = generateTargetedImprovements({ project, sessionResults: results, target: options.target });
      proposals = improvement.proposals;
      if (improvement.memoryItems?.length) {
        memoryWriteResult = writeMemoryDrafts({ config, project, items: improvement.memoryItems });
        for (const item of memoryWriteResult.written) {
          logger.audit("memory_draft_created", "Draft memory item created", {
            component: "proposal",
            projectKey: project.projectKey,
            data: { memoryId: item.id, kind: item.kind, confidence: item.confidence },
          });
        }
      }
    } else {
      proposals = runRuleEngine({ project, sessionResults: results });
    }

    for (const proposal of proposals) {
      logger.info("proposal_candidate_created", "Proposal candidate created", {
        component: "rule_engine",
        projectKey: project.projectKey,
        ruleId: proposal.ruleId,
        data: { title: proposal.title, target: proposal.target, risk: proposal.risk, evidenceCount: proposal.evidence?.length ?? 0 },
      });
    }
    logger.info("rule_engine_end", "Proposal generation finished", {
      component: "rule_engine",
      projectKey: project.projectKey,
      data: { candidates: proposals.length },
    });

    writeResult = writeDraftProposals({ config, project, proposals });
    for (const proposal of writeResult.written) {
      logger.audit("proposal_created", "Draft proposal created", {
        component: "proposal",
        projectKey: project.projectKey,
        ruleId: proposal.ruleId,
        proposalId: proposal.id,
        data: { target: proposal.target, risk: proposal.risk, filePath: proposal.filePath, evidenceCount: proposal.evidence?.length ?? 0 },
      });
    }
    for (const proposal of writeResult.skipped) {
      logger.info("proposal_deduped", "Draft proposal skipped by dedupe", {
        component: "proposal",
        projectKey: project.projectKey,
        ruleId: proposal.ruleId,
        data: { title: proposal.title, reason: proposal.reason, fingerprint: proposal.fingerprint },
      });
    }

    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { candidates: proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length, memoryDrafts: memoryWriteResult.written.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = {
    project,
    sessionDir: config.sessionDir,
    scannedFiles: discovery.scannedFiles ?? 0,
    sessionsScanned: results.length,
    mode: options.target ? `target:${options.target}` : "rules",
    candidates: proposals.length,
    draftDir: writeResult.draftDir,
    memory: memoryWriteResult.draftPath ? { draftPath: memoryWriteResult.draftPath, written: memoryWriteResult.written } : undefined,
    written: writeResult.written.map(publicProposalSummary),
    skipped: writeResult.skipped.map(publicProposalSummary),
    warnings: discovery.warnings,
    sources,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Propose project: ${project.projectKey}`);
  console.log(`Mode: ${output.mode}`);
  console.log(`Scanned files: ${output.scannedFiles}`);
  console.log(`Sessions scanned: ${output.sessionsScanned}`);
  console.log(`Candidates: ${output.candidates}`);
  console.log(`Draft dir: ${output.draftDir}`);
  if (output.memory) console.log(`Memory drafts: ${output.memory.written.length} (${output.memory.draftPath})`);
  console.log(`Written: ${output.written.length}`);
  for (const proposal of output.written) console.log(`- ${proposal.id} ${proposal.title}`);
  if (output.skipped.length) console.log(`Skipped duplicates: ${output.skipped.length}`);
}

function commandProposals(options) {
  const { config, project, logger } = createCommandContext("proposals", options);
  let proposals;

  try {
    proposals = readDraftProposals({ config, project });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      data: { proposals: proposals.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = { project, count: proposals.length, proposals: proposals.map(publicProposalSummary) };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Draft proposals for ${project.projectKey}`);
  if (!proposals.length) {
    console.log("No draft proposals found.");
    return;
  }
  for (const proposal of proposals) {
    console.log(`${proposal.id}  [${proposal.target}/${proposal.risk}]  ${proposal.title}`);
    console.log(`  file: ${proposal.filePath}`);
  }
}

function commandShow(rest, options) {
  const id = rest[0];
  if (!id) throw new CliError("Usage: harness show <proposal-id> [--project <path>] [--json]", 2);

  const { config, project, logger } = createCommandContext("show", options);
  let proposal;
  try {
    proposal = findDraftProposal({ config, project, id });
    if (!proposal) throw new CliError(`Proposal not found: ${id}`, 2);
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      proposalId: id,
      data: { shown: true },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  if (options.json) {
    console.log(JSON.stringify(proposal, null, 2));
    return;
  }

  console.log(fs.readFileSync(proposal.filePath, "utf8"));
}

function commandApprove(rest, options) {
  const id = rest[0];
  if (!id) throw new CliError("Usage: harness approve <proposal-id> [--project <path>] [--json]", 2);
  return commandProposalLifecycle("approve", id, options, ({ config, project, logger }) => approveProposal({ config, project, id, logger }));
}

function commandReject(rest, options) {
  const id = rest[0];
  if (!id) throw new CliError("Usage: harness reject <proposal-id> [--project <path>] [--json]", 2);
  return commandProposalLifecycle("reject", id, options, ({ config, project, logger }) => rejectProposal({ config, project, id, logger }));
}

function commandRollback(rest, options) {
  const id = rest[0];
  if (!id) throw new CliError("Usage: harness rollback <proposal-id> [--project <path>] [--json]", 2);
  return commandProposalLifecycle("rollback", id, options, ({ config, project, logger }) => rollbackProposal({ config, project, id, logger }));
}

function commandApply(rest, options) {
  const id = rest[0];
  if (!id) throw new CliError("Usage: harness apply <proposal-id> [--project <path>] [--allow-dirty] [--skip-tests] [--commit] [--json]", 2);
  return commandProposalLifecycle("apply", id, options, ({ config, project, logger }) => applyProposal({
    config,
    project,
    id,
    allowDirty: Boolean(options.allowDirty),
    skipTests: Boolean(options.skipTests),
    commit: Boolean(options.commit),
    logger,
  }));
}

function commandHistory(rest, options) {
  const id = rest[0];
  const { config, project, logger } = createCommandContext("history", options);
  let history;
  try {
    history = readProposalHistory({ config, project, id });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      proposalId: id,
      data: { historyEvents: history.length },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = { project, proposalId: id, count: history.length, history };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`Proposal history for ${id ?? project.projectKey}`);
  if (!history.length) {
    console.log("No proposal history found.");
    return;
  }
  for (const event of history) console.log(`${event.timestamp}  ${event.proposalId}  ${event.event}  ${event.status}`);
}

function commandProposalLifecycle(command, id, options, action) {
  const { config, project, logger } = createCommandContext(command, options);
  let result;
  try {
    result = action({ config, project, logger });
    logger.info("command_end", "Command finished", {
      component: "cli",
      projectKey: project.projectKey,
      proposalId: id,
      data: { status: result.proposal?.status, event: result.historyEvent?.event },
    });
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  const output = { project, ...result, proposal: publicProposalSummary(result.proposal) };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Proposal ${id}: ${result.proposal.status}`);
  if (result.branchName) console.log(`Branch: ${result.branchName}`);
  if (result.changedPaths?.length) console.log(`Changed: ${result.changedPaths.join(", ")}`);
  if (result.testResults?.length) console.log(`Tests: ${result.testResults.length}`);
  if (result.commitHash) console.log(`Commit: ${result.commitHash}`);
  if (result.diff) {
    console.log("\nDiff");
    console.log(result.diff);
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
    throw new CliError("Usage: harness inspect <session.jsonl> [--entry <id>] [--full] [--tree] [--active-path] [--json]", 2);
  }

  const { project, logger } = createCommandContext("inspect", options);
  let parsed;
  let tree;
  let warnings;
  let activePathEntries;
  let entryOutput;

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
    warnings = enrichWarnings([
      ...parsed.warnings,
      ...tree.warnings,
      ...collectNormalizeWarnings(parsed),
    ], { parsed, project });

    logger.info("parse_end", "Parsed session JSONL", {
      component: "parser",
      projectKey: project.projectKey,
      sessionId: parsed.header?.id,
      sessionFile,
      data: { entries: parsed.entries.length, warnings: warnings.length },
    });

    if (options.entry) {
      entryOutput = inspectEntry(parsed, options.entry, { full: Boolean(options.full) });
      if (!entryOutput.entry) throw new CliError(`Entry not found: ${options.entry}`, 2);
      logger.info("inspect_entry", "Session entry inspected", {
        component: "parser",
        projectKey: project.projectKey,
        sessionId: parsed.header?.id,
        sessionFile,
        entryId: options.entry,
        data: { full: Boolean(options.full), found: Boolean(entryOutput.entry) },
      });
      logger.info("command_end", "Command finished", {
        component: "cli",
        projectKey: project.projectKey,
        data: { inspected: sessionFile, entryId: options.entry, warnings: warnings.length },
      });
    } else {
      activePathEntries = tree.activePathEntryIds
        .map((entryId) => tree.entryMap.get(entryId))
        .filter(Boolean)
        .map(summarizeEntry);

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
    }
  } catch (error) {
    logCommandFailure(logger, project, error);
    throw error;
  }

  if (entryOutput) {
    const output = {
      sessionFile,
      sessionId: parsed.header?.id,
      entryId: options.entry,
      redacted: true,
      full: Boolean(options.full),
      ...entryOutput,
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log("Session entry inspect");
    console.log("---------------------");
    console.log(`File:       ${sessionFile}`);
    console.log(`Session id: ${parsed.header?.id ?? "(missing)"}`);
    console.log(`Entry id:   ${options.entry}`);
    console.log(`Type:       ${entryOutput.summary?.type ?? "(unknown)"}`);
    if (entryOutput.summary?.role) console.log(`Role:       ${entryOutput.summary.role}`);
    if (entryOutput.summary?.toolName) console.log(`Tool:       ${entryOutput.summary.toolName}`);
    if (entryOutput.excerpt) {
      console.log("\nExcerpt");
      console.log(entryOutput.excerpt);
    }
    if (options.full) {
      console.log("\nFull raw entry (redacted)");
      console.log(JSON.stringify(entryOutput.entry, null, 2));
    }
    return;
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

function inspectEntry(parsed, entryId, { full = false } = {}) {
  const entry = parsed.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return { entry: undefined };

  const summary = summarizeEntry(entry);
  const excerpt = entry.type === "message"
    ? makeExcerpt(contentToText(entry.message?.content), 2000).excerpt
    : undefined;
  const redactedEntry = full ? redactValue(entry).value : undefined;

  return {
    summary,
    excerpt,
    entry: full ? redactedEntry : redactValue(summary).value,
  };
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

function publicProposalSummary(proposal) {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    target: proposal.target,
    risk: proposal.risk,
    ruleId: proposal.ruleId,
    fingerprint: proposal.fingerprint,
    evidenceCount: proposal.evidenceCount ?? proposal.evidence?.length,
    filePath: proposal.filePath,
    reason: proposal.reason,
  };
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
    entry: options.entry,
    full: Boolean(options.full),
    rules: Boolean(options.rules),
    target: options.target,
    llm: Boolean(options.llm),
    maxEvents: options.maxEvents,
    maxExcerptChars: options.maxExcerptChars,
    importFile: options.importFile,
    allowDirty: Boolean(options.allowDirty),
    skipTests: Boolean(options.skipTests),
    commit: Boolean(options.commit),
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
      case "--entry":
        options.entry = requireValue(args, ++i, arg);
        break;
      case "--full":
        options.full = true;
        break;
      case "--rules":
        options.rules = true;
        break;
      case "--target":
        options.target = requireValue(args, ++i, arg);
        break;
      case "--llm":
        options.llm = true;
        break;
      case "--max-events":
        options.maxEvents = Number(requireValue(args, ++i, arg));
        if (!Number.isFinite(options.maxEvents)) throw new CliError(`Invalid number for ${arg}`, 2);
        break;
      case "--max-excerpt-chars":
        options.maxExcerptChars = Number(requireValue(args, ++i, arg));
        if (!Number.isFinite(options.maxExcerptChars)) throw new CliError(`Invalid number for ${arg}`, 2);
        break;
      case "--import":
        options.importFile = requireValue(args, ++i, arg);
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--skip-tests":
        options.skipTests = true;
        break;
      case "--commit":
        options.commit = true;
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
  harness report [--project <path>] [--last <n>] [--json]
  harness reflect [--project <path>] [--last <n>] [--max-events <n>] [--max-excerpt-chars <n>] [--json]
  harness reflect --import <llm-response.json> [--project <path>] [--json]
  harness propose --rules [--project <path>] [--last <n>] [--json]
  harness propose --target <memory|rules|parser|redaction> [--project <path>] [--last <n>] [--json]
  harness propose --llm [--project <path>] [--last <n>] [--json]
  harness proposals [--project <path>] [--json]
  harness show <proposal-id> [--project <path>] [--json]
  harness approve <proposal-id> [--project <path>] [--json]
  harness reject <proposal-id> [--project <path>] [--json]
  harness apply <proposal-id> [--project <path>] [--allow-dirty] [--skip-tests] [--commit] [--json]
  harness rollback <proposal-id> [--project <path>] [--json]
  harness history [proposal-id] [--project <path>] [--json]
  harness inspect <session.jsonl> [--entry <id>] [--full] [--tree] [--active-path] [--json]

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
      --last <n>             Max sessions per scan/report/propose
      --rules                Generate deterministic rule-based proposals
      --target <target>      Generate target-specific improvement proposals
      --llm                  Prepare an LLM reflection prompt from normalized evidence
      --max-events <n>       Max evidence items for reflect/propose --llm
      --max-excerpt-chars <n> Max chars per evidence excerpt for reflect/propose --llm
      --import <path>        Import LLM reflection JSON response as draft proposals
      --allow-dirty          Allow apply with dirty git worktree
      --skip-tests           Apply without running extracted proposal test commands
      --commit               Commit applied proposal after patch/tests succeed
      --entry <id>           Inspect one rawRef entry by id
      --full                 With --entry, print full raw entry after redaction
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
  if (error instanceof CliError || Number.isInteger(error?.exitCode)) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error(error.stack || error.message);
  process.exit(1);
});
