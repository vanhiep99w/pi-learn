import fs from "node:fs";
import { loadConfig } from "./config/load-config.js";
import { checkWritableDirectory, ensureHarnessHome, projectCacheDir } from "./storage/harness-home.js";
import { createAnalysisRun as freezeAnalysisRun, consumeAnalysisRun, readAnalysisRunContext } from "./analysis/analysis-run.js";
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
import { publicCandidateReview, reviewCandidateSignals } from "./analysis/candidate-review.js";
import { buildTaskEpisodeArtifacts } from "./analysis/task-episodes.js";
import { collectProjectEvidence } from "./analysis/project-evidence.js";
import { collectAgentAssetEvidence } from "./analysis/agent-assets.js";
import { generateTargetedImprovements } from "./improve/target-proposals.js";
import { writeMemoryDrafts } from "./memory/memory-drafts.js";
import { beginCandidateReviewAttempt, finalizeCandidateReviewAttempt } from "./storage/candidate-review-writer.js";
import { writeTaskEpisodeArtifacts } from "./storage/task-episodes-writer.js";
import { findDraftProposal, readDraftProposals, writeDraftProposals } from "./proposals/proposal-writer.js";
import { approveProposal, applyProposal, readProposalHistory, rejectProposal, rollbackProposal } from "./proposals/lifecycle.js";
import { resolveProject } from "./project/resolve-project.js";
import { pathExists, resolvePath } from "./utils/path.js";
import { readFindingsLedger, writeFindingsLedger } from "./findings/ledger.js";
import { EVIDENCE_STATES, EvidenceState, isEvidenceState, normalizeEvidenceState } from "./findings/evidence-states.js";

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

export function projectEvidence(options = {}) {
  const project = resolveProject(options.project ?? process.cwd());
  return collectProjectEvidence({
    project,
    limits: options.projectEvidenceLimits ?? options.limits,
  });
}

export function agentAssets(options = {}) {
  const project = resolveProject(options.project ?? process.cwd());
  return collectAgentAssetEvidence({
    project,
    ownerRoutes: options.ownerRoutes,
    limits: options.agentAssetLimits ?? options.limits,
  });
}

export function writeFindings(options = {}) {
  const { config, project } = loadConfig(options);
  return writeFindingsLedger({
    config,
    project,
    findings: options.findings,
    now: options.now,
  });
}

export function readFindings(options = {}) {
  const { config, project } = loadConfig(options);
  return readFindingsLedger({ config, project });
}

export function findings(options = {}) {
  return readFindings(options);
}

export { EVIDENCE_STATES, EvidenceState, isEvidenceState, normalizeEvidenceState };

export function analysisRun(options = {}) {
  const { config, project, logger } = createHarnessContext("analysis-run", options);
  ensureHarnessHome(config);
  try {
    const run = resolveAnalysisRun({ options, config, project, logger });
    end(logger, project, { runId: run.runId, selectedCount: run.selection.selectedCount });
    return run;
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export function sessions(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("sessions", options);
  ensureHarnessHome(config);
  try {
    const run = resolveAnalysisRun({ options, config, project, logger });
    end(logger, project, { sessions: run.sessions.length, warnings: run.warnings.length, runId: run.runId });
    return runPopulationOutput({ project, config, sources, run });
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function scan(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("scan", options);
  ensureHarnessHome(config);
  try {
    const run = resolveAnalysisRun({ options, config, project, logger });
    const consumed = await consumeAnalysisRun({ analysisRun: run, config, project, logger, consumer: "scan" });
    end(logger, project, { sessionsCached: consumed.results.length, runId: run.runId });
    return {
      ...runPopulationOutput({ project, config, sources, run: consumed.analysisRun }),
      count: consumed.results.length,
      results: consumed.results.map(publicScanResult),
      warnings: [...run.warnings, ...consumed.warnings],
    };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function taskEpisodes(options = {}) {
  const { config, project, logger } = createHarnessContext("task-episodes", options);
  ensureHarnessHome(config);
  try {
    const run = resolveAnalysisRun({ options, config, project, logger });
    const consumed = await consumeAnalysisRun({
      analysisRun: run,
      config,
      project,
      logger,
      consumer: "task-episodes",
    });
    const artifacts = buildTaskEpisodeArtifacts({
      analysisRun: consumed.analysisRun,
      sessionResults: consumed.results,
      projectRoot: project.projectRoot,
    });
    const publication = writeTaskEpisodeArtifacts({
      config,
      project,
      analysisRun: consumed.analysisRun,
      privateArtifact: artifacts.privateArtifact,
      readerArtifact: artifacts.readerArtifact,
    });
    end(logger, project, {
      runId: run.runId,
      status: publication.reader.status,
      candidates: publication.reader.counts.candidates,
      retained: publication.reader.counts.retained,
    });
    return publication.reader;
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function report(options = {}) {
  const { config, project, sources, logger } = createHarnessContext("report", options);
  ensureHarnessHome(config);
  try {
    const run = resolveAnalysisRun({ options, config, project, logger });
    const consumed = await consumeAnalysisRun({ analysisRun: run, config, project, logger, consumer: "report" });
    const now = new Date();
    const markdown = generateProjectReport({ project, results: consumed.results, analysisRun: consumed.analysisRun, generatedAt: now });
    const reportPaths = writeProjectReport({ config, project, markdown, now });
    logger.info("report_generated", "Markdown report generated", { component: "report", projectKey: project.projectKey, data: { latestPath: reportPaths.latestPath, datedPath: reportPaths.datedPath, sessions: consumed.results.length, runId: run.runId } });
    end(logger, project, { sessionsReported: consumed.results.length, reportPath: reportPaths.latestPath, runId: run.runId });
    return {
      ...runPopulationOutput({ project, config, sources, run: consumed.analysisRun }),
      count: consumed.results.length,
      report: reportPaths,
      results: consumed.results.map(publicScanResult),
      warnings: [...run.warnings, ...consumed.warnings],
    };
  } catch (error) {
    fail(logger, project, error);
    throw error;
  }
}

export async function reflect(options = {}) {
  const { config, project, sources, logger } = createHarnessContext(options.proposeMode ? "propose --llm" : "reflect", options);
  ensureHarnessHome(config);
  try {
    const run = resolveAnalysisRun({ options, config, project, logger });
    const consumed = await consumeAnalysisRun({ analysisRun: run, config, project, logger, consumer: "reflect" });
    const now = new Date();
    const reflection = buildReflection({ project, sessionResults: consumed.results, analysisRun: consumed.analysisRun, generatedAt: now, maxEvents: options.maxEvents, maxExcerptChars: options.maxExcerptChars });
    const reflectionPaths = writeReflectionPrompt({ config, project, prompt: reflection.prompt, now });
    logger.info("reflection_prompt_written", "LLM reflection prompt written", { component: "reflection", projectKey: project.projectKey, data: { latestPath: reflectionPaths.latestPath, evidenceCount: reflection.evidence.length, runId: run.runId } });
    end(logger, project, { sessionsReflected: consumed.results.length, evidenceCount: reflection.evidence.length, runId: run.runId });
    return {
      project,
      sessionDir: config.sessionDir,
      scannedFiles: run.selection.scannedFiles,
      sessions: run.sessions,
      sessionsScanned: consumed.results.length,
      mode: options.proposeMode ? "llm_reflection_prompt" : "reflect",
      reflection: reflectionPaths,
      evidenceCount: reflection.evidence.length,
      metrics: reflection.metrics,
      warnings: [...run.warnings, ...consumed.warnings],
      analysisRun: consumed.analysisRun,
      sources,
    };
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
    const run = resolveAnalysisRun({ options, config, project, logger });
    const consumed = await consumeAnalysisRun({ analysisRun: run, config, project, logger, consumer: "propose" });
    const mode = options.target ? `target:${options.target}` : "rules";
    if (options.target === "memory") {
      const improvement = generateTargetedImprovements({ project, sessionResults: consumed.results, target: "memory" });
      const memoryWriteResult = improvement.memoryItems?.length
        ? writeMemoryDrafts({ config, project, items: improvement.memoryItems })
        : { written: [] };
      const writeResult = writeDraftProposals({ config, project, proposals: improvement.proposals });
      end(logger, project, { candidates: improvement.proposals.length, written: writeResult.written.length, skipped: writeResult.skipped.length, memoryDrafts: memoryWriteResult.written.length, runId: run.runId });
      return { project, sessionDir: config.sessionDir, scannedFiles: run.selection.scannedFiles, sessionsScanned: consumed.results.length, mode, candidates: improvement.proposals.length, draftDir: writeResult.draftDir, memory: memoryWriteResult.draftPath ? { draftPath: memoryWriteResult.draftPath, written: memoryWriteResult.written } : undefined, written: writeResult.written.map(publicProposalSummary), skipped: writeResult.skipped.map(publicProposalSummary), warnings: [...run.warnings, ...consumed.warnings], analysisRun: consumed.analysisRun, sources };
    }

    const detected = runRuleEngine({ project, sessionResults: consumed.results });
    const candidateSignals = selectCandidateSignals(detected, options.target);
    const review = reviewCandidateSignals({ project, candidates: candidateSignals });
    const attempt = beginCandidateReviewAttempt({ config, project, analysisRun: consumed.analysisRun, mode, review });
    const writeResult = writeDraftProposals({ config, project, proposals: review.proposals });
    finalizeCandidateReviewAttempt({ attempt, config, project, analysisRun: consumed.analysisRun, mode, review, writeResult });
    const projection = publicCandidateReview(review);
    end(logger, project, { candidates: projection.candidates, promoted: projection.promoted, deferred: projection.deferred, rejected: projection.rejected, written: writeResult.written.length, skipped: writeResult.skipped.length, runId: run.runId });
    return {
      project,
      sessionDir: config.sessionDir,
      scannedFiles: run.selection.scannedFiles,
      sessionsScanned: consumed.results.length,
      mode,
      ...projection,
      draftDir: writeResult.draftDir,
      reviewReceipt: { stored: true, mode, attemptId: attempt.attemptId },
      written: writeResult.written.map(publicProposalSummary),
      skipped: writeResult.skipped.map(publicProposalSummary),
      warnings: [...run.warnings, ...consumed.warnings],
      analysisRun: consumed.analysisRun,
      sources,
    };
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
  const supportedTargets = status.automation.proposeTargets.filter((target) => ["memory", "rules", "parser", "redaction"].includes(target));
  const hasSessionStages = status.automation.scan
    || status.automation.report
    || status.automation.proposeRules
    || supportedTargets.length > 0;
  const sharedRun = hasSessionStages
    ? freezeAnalysisRun({
      config: { ...config, maxSessionsPerScan: automationOptions.maxSessionsPerScan },
      project,
      logger,
    })
    : undefined;
  const stageOptions = sharedRun ? { ...automationOptions, analysisRun: sharedRun } : automationOptions;

  let reportResult;
  if (status.automation.scan) {
    const scanResult = await scan(stageOptions);
    actions.push({ name: "scan", status: "done", sessions: scanResult.count, analysisRun: automationRunBinding(scanResult.analysisRun) });
  }
  if (status.automation.report) {
    reportResult = await report(stageOptions);
    actions.push({ name: "report", status: "done", path: reportResult.report.latestPath, analysisRun: automationRunBinding(reportResult.analysisRun) });
  }
  if (status.automation.proposeRules) {
    const result = await propose({ ...stageOptions, rules: true });
    actions.push({ name: "propose:rules", status: "done", promoted: result.promoted, deferred: result.deferred, rejected: result.rejected, written: result.written.length, skipped: result.skipped.length, analysisRun: automationRunBinding(result.analysisRun) });
  }
  for (const target of status.automation.proposeTargets) {
    if (!["memory", "rules", "parser", "redaction"].includes(target)) {
      actions.push({ name: `propose:${target}`, status: "skipped", reason: "unsupported_target" });
      continue;
    }
    const result = await propose({ ...stageOptions, target });
    actions.push({ name: `propose:${target}`, status: "done", promoted: result.promoted, deferred: result.deferred, rejected: result.rejected, written: result.written.length, skipped: result.skipped.length, memoryDrafts: result.memory?.written?.length ?? 0, analysisRun: automationRunBinding(result.analysisRun) });
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

  const runBinding = automationRunBinding(sharedRun);
  logger.audit("automation_completed", "Gated automation completed", { component: "automation", projectKey: project.projectKey, data: { actions, analysisRun: runBinding } });
  end(logger, project, { actions: actions.length, runId: runBinding?.runId });
  return { project, status: "done", automation: status, analysisRun: runBinding, actions };
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

function resolveAnalysisRun({ options, config, project, logger }) {
  if (options.analysisRun) {
    readAnalysisRunContext({ analysisRun: options.analysisRun, config, project });
    return options.analysisRun;
  }
  logger.info("session_discovery_start", "Session discovery started", { component: "session_discovery", projectKey: project.projectKey, data: { sessionDir: config.sessionDir, maxSessionsPerScan: config.maxSessionsPerScan } });
  const run = freezeAnalysisRun({ config, project, logger, now: options.now, runId: options.runId });
  logger.info("session_discovery_end", "Session discovery finished", { component: "session_discovery", projectKey: project.projectKey, data: { scannedFiles: run.selection.scannedFiles, eligible: run.selection.eligibleCount, selected: run.selection.selectedCount, warnings: run.warnings.length, runId: run.runId } });
  return run;
}

function runPopulationOutput({ project, config, sources, run }) {
  return {
    project,
    sessionDir: config.sessionDir,
    scannedFiles: run.selection.scannedFiles,
    eligibleCount: run.selection.eligibleCount,
    selectedCount: run.selection.selectedCount,
    count: run.sessions.length,
    sessions: run.sessions,
    warnings: run.warnings,
    analysisRun: run,
    sources,
  };
}

function automationRunBinding(run) {
  if (!run) return undefined;
  return {
    runId: run.runId,
    selectedFingerprint: run.selection?.selectedFingerprint,
    selectedCount: run.selection?.selectedCount ?? 0,
    consumerStatus: run.consumption?.status ?? run.laneStatus?.consumer ?? "pending",
    acceptedCount: run.consumption?.acceptedCount,
    skippedCount: run.consumption?.skippedCount,
  };
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
  return { id: proposal.id, title: proposal.title, status: proposal.status, target: proposal.target, risk: proposal.risk, ruleId: proposal.ruleId, candidateId: proposal.candidateId, detectorId: proposal.detectorId, reviewFingerprint: proposal.reviewFingerprint, fingerprint: proposal.fingerprint, evidenceCount: proposal.evidenceCount ?? proposal.evidence?.length, filePath: proposal.filePath, reason: proposal.reason };
}

function selectCandidateSignals(candidates, target) {
  if (!target) return candidates;
  const detectorIds = target === "rules"
    ? new Set(["R-0001", "R-0002"])
    : target === "parser"
      ? new Set(["R-0004"])
      : target === "redaction"
        ? new Set(["R-0003"])
        : new Set();
  return candidates.filter((candidate) => detectorIds.has(candidate.detectorId));
}

function publicConfigSummary(config) {
  return { sessionDir: config.sessionDir, harnessHome: config.harnessHome, projectCwd: config.projectCwd, redact: config.redact, activePathOnly: config.activePathOnly, maxSessionsPerScan: config.maxSessionsPerScan, autoApply: config.autoApply, autoPush: config.autoPush, automation: config.automation, logging: { enabled: config.logging?.enabled, level: config.logging?.level, logDir: config.logging?.logDir, console: config.logging?.console } };
}

function safeOptionSummary(options) {
  return { project: options.project, sessionDir: options.sessionDir, harnessHome: options.harnessHome, maxSessionsPerScan: options.maxSessionsPerScan, analysisRunId: options.analysisRun?.runId, rules: Boolean(options.rules), target: options.target, llm: Boolean(options.llm), scenario: options.scenario, entry: options.entry, full: Boolean(options.full) };
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
