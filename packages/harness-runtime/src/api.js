import fs from "node:fs";
import { loadConfig } from "./config/load-config.js";
import { checkWritableDirectory, ensureHarnessHome, projectCacheDir } from "./storage/harness-home.js";
import { writeSessionCache } from "./storage/cache-writer.js";
import { discoverSessions } from "./session/discover-sessions.js";
import { createLogger } from "./logging/logger.js";
import { parseSessionFile, summarizeEntry } from "./session/parse-session.js";
import { buildSessionTree, summarizeTree } from "./session/tree.js";
import { collectNormalizeWarnings, enrichWarnings } from "./session/warnings.js";
import { contentToText, makeExcerpt } from "./normalize/content.js";
import { redactValue } from "./safety/redaction.js";
import { generateProjectReport, writeProjectReport } from "./report/report.js";
import { buildReflection, reflectionResponseToProposals, writeReflectionPrompt } from "./reflection/reflection.js";
import { runEvalHarness } from "./eval/eval-harness.js";
import { createEvalFixtureDraftProposal, getAutomationStatus } from "./automation/gated-automation.js";
import { runRuleEngine } from "./analysis/rules.js";
import { generateTargetedImprovements } from "./improve/target-proposals.js";
import { writeMemoryDrafts } from "./memory/memory-drafts.js";
import { findDraftProposal, readDraftProposals, writeDraftProposals } from "./proposals/proposal-writer.js";
import { approveProposal, applyProposal, readProposalHistory, rejectProposal, rollbackProposal } from "./proposals/lifecycle.js";
import { pathExists, resolvePath } from "./utils/path.js";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = packageJson.version;

export function createHarnessContext(operation, options = {}) {
  const { config, project, sources } = loadConfig(options);
  const logger = createLogger({ config, command: operation, project });
  logger.info("command_start", "Operation started", {
    component: "api",
    projectKey: project.projectKey,
    data: { operation, options: safeOptionSummary(options) },
  });
  logger.info("config_loaded", "Config loaded", {
    component: "config",
    projectKey: project.projectKey,
    data: { globalConfigFound: sources.globalConfigFound, projectConfigFound: sources.projectConfigFound, config: publicConfigSummary(config) },
  });
  logger.info("project_resolved", "Project resolved", { component: "project", projectKey: project.projectKey, data: project });
  return { config, project, sources, logger };
}

export function doctor(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("doctor", options);
  try {
    const harnessHome = ensureHarnessHome(config);
    const sessionDirExists = pathExists(config.sessionDir);
    let harnessHomeWritable = false;
    let harnessHomeError;
    try {
      harnessHomeWritable = checkWritableDirectory(harnessHome);
    } catch (error) {
      harnessHomeError = error.message;
      logger.warn("doctor_probe_failed", "Harness home writable probe failed", { component: "storage", projectKey: project.projectKey, data: { harnessHome, error: error.message } });
    }
    const result = {
      ok: Boolean(sessionDirExists && harnessHomeWritable),
      version: VERSION,
      config: publicConfigSummary(config),
      project,
      cache: { harnessHome, projectCacheDir: projectCacheDir(harnessHome, project.projectKey), sessionDirExists, harnessHomeWritable, harnessHomeError },
      sources,
    };
    end(logger, project, { ok: result.ok });
    return result;
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function configPrint(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("config print", options);
  end(logger, project, { printed: "config" });
  return { config, project, sources };
}

export function projectResolve(options = {}) {
  const { project, logger } = createHarnessContext("project resolve", options);
  end(logger, project, { resolved: true });
  return project;
}

export function sessions(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("sessions", options);
  try {
    const result = runSessionDiscovery({ config, project, logger });
    end(logger, project, { sessions: result.sessions.length, warnings: result.warnings.length });
    return { project, sessionDir: config.sessionDir, scannedFiles: result.scannedFiles ?? 0, count: result.sessions.length, sessions: result.sessions, warnings: result.warnings, sources };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function scan(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("scan", options);
  ensureHarnessHome(config);
  try {
    const discovery = runSessionDiscovery({ config, project, logger });
    const results = [];
    for (const session of discovery.sessions) results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    end(logger, project, { sessionsCached: results.length });
    return { project, sessionDir: config.sessionDir, scannedFiles: discovery.scannedFiles ?? 0, count: results.length, results: results.map(publicScanResult), warnings: discovery.warnings, sources };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function report(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("report", options);
  ensureHarnessHome(config);
  try {
    const discovery = runSessionDiscovery({ config, project, logger });
    const results = [];
    for (const session of discovery.sessions) results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    const now = new Date();
    const markdown = generateProjectReport({ project, results, generatedAt: now });
    const reportPaths = writeProjectReport({ config, project, markdown, now });
    logger.info("report_generated", "Markdown report generated", { component: "report", projectKey: project.projectKey, data: { latestPath: reportPaths.latestPath, datedPath: reportPaths.datedPath, sessions: results.length } });
    end(logger, project, { sessionsReported: results.length, reportPath: reportPaths.latestPath });
    return { project, sessionDir: config.sessionDir, scannedFiles: discovery.scannedFiles ?? 0, count: results.length, report: reportPaths, results: results.map(publicScanResult), warnings: discovery.warnings, sources };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function reflect(options = {}) {
  const { config, project, sources, logger } = createHarnessContext(options.proposeMode ? "propose --llm" : "reflect", options);
  ensureHarnessHome(config);
  try {
    const discovery = runSessionDiscovery({ config, project, logger });
    const results = [];
    for (const session of discovery.sessions) results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    const now = new Date();
    const reflection = buildReflection({ project, sessionResults: results, generatedAt: now, maxEvents: options.maxEvents, maxExcerptChars: options.maxExcerptChars });
    const reflectionPaths = writeReflectionPrompt({ config, project, prompt: reflection.prompt, now });
    logger.info("reflection_prompt_written", "LLM reflection prompt written", { component: "reflection", projectKey: project.projectKey, data: { latestPath: reflectionPaths.latestPath, evidenceCount: reflection.evidence.length } });
    end(logger, project, { sessionsReflected: results.length, evidenceCount: reflection.evidence.length });
    return { project, sessionDir: config.sessionDir, scannedFiles: discovery.scannedFiles ?? 0, sessionsScanned: results.length, mode: options.proposeMode ? "llm_reflection_prompt" : "reflect", reflection: reflectionPaths, evidenceCount: reflection.evidence.length, metrics: reflection.metrics, warnings: discovery.warnings, sources };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function importReflection(options = {}) {
  const importPath = resolvePath(options.importFile);
  const response = fs.readFileSync(importPath, "utf8");
  return importReflectionResponse({ ...options, response, importPath });
}

export function importReflectionResponse(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("reflect import", options);
  const importPath = options.importPath;
  try {
    const proposals = reflectionResponseToProposals({ response: options.response, project });
    const writeResult = writeDraftProposals({ config, project, proposals });
    logger.audit("reflection_imported", "LLM reflection response imported as draft proposals", { component: "reflection", projectKey: project.projectKey, data: { importPath, candidates: proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length } });
    end(logger, project, { imported: importPath, candidates: proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length });
    return { project, mode: "reflect_import", importPath, candidates: proposals.length, draftDir: writeResult.draftDir, written: writeResult.written.map(publicProposalSummary), skipped: writeResult.skipped.map(publicProposalSummary), sources };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function propose(options = {}) {
  if (options.llm) return reflect({ ...options, proposeMode: true });
  if (!options.rules && !options.target) throw cliLikeError("Usage: propose requires rules, target, or llm mode");
  if (options.target && !["memory", "rules", "parser", "redaction"].includes(options.target)) throw cliLikeError(`Unsupported propose target: ${options.target}`);
  const { config, project, sources, logger } = createHarnessContext("propose", options);
  ensureHarnessHome(config);
  try {
    const discovery = runSessionDiscovery({ config, project, logger });
    const results = [];
    for (const session of discovery.sessions) results.push(await writeSessionCache({ sessionFile: session.sessionFile, config, project, logger }));
    let proposals;
    let memoryWriteResult = { written: [] };
    if (options.target) {
      const improvement = generateTargetedImprovements({ project, sessionResults: results, target: options.target });
      proposals = improvement.proposals;
      if (improvement.memoryItems?.length) memoryWriteResult = writeMemoryDrafts({ config, project, items: improvement.memoryItems });
    } else {
      proposals = runRuleEngine({ project, sessionResults: results });
    }
    const writeResult = writeDraftProposals({ config, project, proposals });
    end(logger, project, { candidates: proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length, memoryDrafts: memoryWriteResult.written.length });
    return { project, sessionDir: config.sessionDir, scannedFiles: discovery.scannedFiles ?? 0, sessionsScanned: results.length, mode: options.target ? `target:${options.target}` : "rules", candidates: proposals.length, draftDir: writeResult.draftDir, memory: memoryWriteResult.draftPath ? { draftPath: memoryWriteResult.draftPath, written: memoryWriteResult.written } : undefined, written: writeResult.written.map(publicProposalSummary), skipped: writeResult.skipped.map(publicProposalSummary), warnings: discovery.warnings, sources };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function proposals(options = {}) {
  const { config, project, logger } = createHarnessContext("proposals", options);
  try {
    const items = readDraftProposals({ config, project });
    end(logger, project, { proposals: items.length });
    return { project, count: items.length, proposals: items.map(publicProposalSummary) };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function showProposal(options = {}) {
  const { config, project, logger } = createHarnessContext("show", options);
  try {
    const proposal = findDraftProposal({ config, project, id: options.id });
    if (!proposal) throw cliLikeError(`Proposal not found: ${options.id}`);
    end(logger, project, { shown: true });
    return proposal;
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function approve(options = {}) {
  return lifecycle("approve", options, ({ config, project, logger }) => approveProposal({ config, project, id: options.id, logger }));
}
export function reject(options = {}) {
  return lifecycle("reject", options, ({ config, project, logger }) => rejectProposal({ config, project, id: options.id, logger }));
}
export function rollback(options = {}) {
  return lifecycle("rollback", options, ({ config, project, logger }) => rollbackProposal({ config, project, id: options.id, logger }));
}
export function apply(options = {}) {
  return lifecycle("apply", options, ({ config, project, logger }) => applyProposal({ config, project, id: options.id, allowDirty: Boolean(options.allowDirty), commit: Boolean(options.commit), logger }));
}

export function history(options = {}) {
  const { config, project, logger } = createHarnessContext("history", options);
  try {
    const items = readProposalHistory({ config, project, id: options.id });
    end(logger, project, { historyEvents: items.length });
    return { project, proposalId: options.id, count: items.length, history: items };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function automationStatus(options = {}) {
  const { config, project, logger } = createHarnessContext("automation status", options);
  const status = getAutomationStatus(config);
  end(logger, project, { enabled: status.enabled, allowed: status.allowed, reason: status.reason });
  return { project, status };
}

export async function automate(options = {}) {
  const { config, project, logger } = createHarnessContext("automate", options);
  const status = getAutomationStatus(config);
  if (!status.allowed) {
    end(logger, project, { skipped: true, reason: status.reason });
    return { project, status: "skipped", reason: status.reason, automation: status, actions: [] };
  }

  const actions = [];
  const automationOptions = {
    ...options,
    project: options.project ?? project.cwd,
    maxSessionsPerScan: Number(config.automation?.maxSessions ?? options.maxSessionsPerScan ?? 5),
  };

  let reportResult;
  if (status.automation.scan) {
    const scanResult = await scan(automationOptions);
    actions.push({ name: "scan", status: "done", sessions: scanResult.count });
  }
  if (status.automation.report) {
    reportResult = await report(automationOptions);
    actions.push({ name: "report", status: "done", path: reportResult.report.latestPath });
  }
  if (status.automation.proposeRules) {
    const result = await propose({ ...automationOptions, rules: true });
    actions.push({ name: "propose:rules", status: "done", written: result.written.length, skipped: result.skipped.length });
  }
  for (const target of status.automation.proposeTargets) {
    if (!["memory", "rules", "parser", "redaction"].includes(target)) {
      actions.push({ name: `propose:${target}`, status: "skipped", reason: "unsupported_target" });
      continue;
    }
    const result = await propose({ ...automationOptions, target });
    actions.push({ name: `propose:${target}`, status: "done", written: result.written.length, skipped: result.skipped.length, memoryDrafts: result.memory?.written?.length ?? 0 });
  }

  let evalResult;
  if (status.automation.eval) {
    evalResult = await runEvalHarness({ config, project });
    actions.push({ name: "eval", status: evalResult.summary.failed ? "failed" : "done", passed: evalResult.summary.passed, failed: evalResult.summary.failed, report: evalResult.paths.latestMarkdownPath });
  }
  if (status.automation.createEvalFixtureDraft) {
    const proposal = createEvalFixtureDraftProposal({ project, evalResult, reportResult });
    const writeResult = writeDraftProposals({ config, project, proposals: [proposal] });
    actions.push({ name: "draft:eval-fixture", status: "done", written: writeResult.written.length, skipped: writeResult.skipped.length });
  }

  logger.audit("automation_completed", "Gated automation completed", { component: "automation", projectKey: project.projectKey, data: { actions } });
  end(logger, project, { actions: actions.length });
  return { project, status: "done", automation: status, actions };
}

export async function evalHarness(options = {}) {
  const { config, project, logger } = createHarnessContext("eval", options);
  try {
    const result = await runEvalHarness({ config, project, scenario: options.scenario, proposalId: options.id });
    logger.audit("eval_completed", "Harness eval completed", { component: "eval", projectKey: project.projectKey, proposalId: options.id, data: { scenario: options.scenario, passed: result.summary.passed, failed: result.summary.failed, latestJsonPath: result.paths.latestJsonPath } });
    end(logger, project, { scenario: options.scenario, passed: result.summary.passed, failed: result.summary.failed });
    return result;
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function inspect(options = {}) {
  const sessionFile = options.sessionFile ? resolvePath(options.sessionFile) : undefined;
  if (!sessionFile) throw cliLikeError("inspect requires sessionFile");
  const { project, logger } = createHarnessContext("inspect", options);
  try {
    const parsed = await parseSessionFile(sessionFile);
    const tree = buildSessionTree(parsed.entries, sessionFile);
    const warnings = enrichWarnings([...parsed.warnings, ...tree.warnings, ...collectNormalizeWarnings(parsed)], { parsed, project });
    if (options.entry) {
      const entryOutput = inspectEntry(parsed, options.entry, { full: Boolean(options.full) });
      if (!entryOutput.entry) throw cliLikeError(`Entry not found: ${options.entry}`);
      end(logger, project, { inspected: sessionFile, entryId: options.entry, warnings: warnings.length });
      return { sessionFile, sessionId: parsed.header?.id, entryId: options.entry, redacted: true, full: Boolean(options.full), ...entryOutput };
    }
    const activePath = tree.activePathEntryIds.map((entryId) => tree.entryMap.get(entryId)).filter(Boolean).map(summarizeEntry);
    end(logger, project, { inspected: sessionFile, warnings: warnings.length });
    return { sessionFile, header: parsed.header, stats: parsed.stats, entryCount: parsed.entries.length, tree: summarizeTree(tree, parsed.entries), activePath, warnings };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

function lifecycle(operation, options, action) {
  const { config, project, logger } = createHarnessContext(operation, options);
  try {
    const result = action({ config, project, logger });
    end(logger, project, { status: result.proposal?.status, event: result.historyEvent?.event });
    return { project, ...result, proposal: publicProposalSummary(result.proposal) };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

function runSessionDiscovery({ config, project, logger }) {
  logger.info("session_discovery_start", "Session discovery started", { component: "session_discovery", projectKey: project.projectKey, data: { sessionDir: config.sessionDir, maxSessionsPerScan: config.maxSessionsPerScan } });
  const result = discoverSessions(config, project, { maxSessions: config.maxSessionsPerScan });
  logger.info("session_discovery_end", "Session discovery finished", { component: "session_discovery", projectKey: project.projectKey, data: { scannedFiles: result.scannedFiles ?? 0, matched: result.sessions.length, warnings: result.warnings.length } });
  return result;
}

function inspectEntry(parsed, entryId, { full = false } = {}) {
  const entry = parsed.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return { entry: undefined };
  const summary = summarizeEntry(entry);
  const excerpt = entry.type === "message" ? makeExcerpt(contentToText(entry.message?.content), 2000).excerpt : undefined;
  return { summary, excerpt, entry: full ? redactValue(entry).value : redactValue(summary).value };
}

function publicScanResult(result) {
  return { sessionId: result.sessionId, sessionFile: result.sessionFile, outDir: result.outDir, eventCount: result.eventCount, warningsCount: result.warnings.length, warnings: result.warnings, metrics: result.metrics };
}

function publicProposalSummary(proposal = {}) {
  return { id: proposal.id, title: proposal.title, status: proposal.status, target: proposal.target, risk: proposal.risk, ruleId: proposal.ruleId, fingerprint: proposal.fingerprint, evidenceCount: proposal.evidenceCount ?? proposal.evidence?.length, filePath: proposal.filePath, reason: proposal.reason };
}

function publicConfigSummary(config) {
  return { sessionDir: config.sessionDir, harnessHome: config.harnessHome, projectCwd: config.projectCwd, redact: config.redact, activePathOnly: config.activePathOnly, maxSessionsPerScan: config.maxSessionsPerScan, autoApply: config.autoApply, autoPush: config.autoPush, automation: config.automation, logging: { enabled: config.logging?.enabled, level: config.logging?.level, logDir: config.logging?.logDir, console: config.logging?.console } };
}

function safeOptionSummary(options) {
  return { project: options.project, sessionDir: options.sessionDir, harnessHome: options.harnessHome, maxSessionsPerScan: options.maxSessionsPerScan, rules: Boolean(options.rules), target: options.target, llm: Boolean(options.llm), scenario: options.scenario, entry: options.entry, full: Boolean(options.full) };
}

function end(logger, project, data) {
  logger.info("command_end", "Operation finished", { component: "api", projectKey: project.projectKey, data });
}

function fail(logger, project, error) {
  logger.error("command_failed", error.message, { component: "api", projectKey: project.projectKey, data: { name: error.name, exitCode: error.exitCode, stack: error.stack } });
}

function cliLikeError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}
