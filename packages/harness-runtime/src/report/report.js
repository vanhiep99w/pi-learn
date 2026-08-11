import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";

export function generateProjectReport({ project, results, analysisRun, findingsProjection, generatedAt = new Date() }) {
  const totals = createEmptyTotals();
  const toolFailures = new Map();
  const bashFailures = [];
  const safetyFindings = [];
  const warningRows = [];

  for (const result of results) {
    addMetrics(totals, result.metrics);
    const events = readJsonlSafe(result.paths?.events);

    for (const event of events) {
      if (!event.activePath) continue;

      if (event.kind === "tool_result" && event.tool?.isError) {
        incrementMap(toolFailures, event.tool?.name ?? "unknown");
      }

      if (event.kind === "bash_execution" && Number(event.bash?.exitCode) !== 0) {
        bashFailures.push({
          sessionId: result.sessionId,
          entryId: event.entryId,
          command: event.bash?.command,
          exitCode: event.bash?.exitCode,
          excerpt: firstNonEmpty(event.bash?.errorLines?.slice(0, 3).join(" | "), event.excerpt, event.summary),
        });
      }

      if (event.safety?.sensitivePath || event.safety?.secretDetected || event.safety?.redacted) {
        safetyFindings.push({
          sessionId: result.sessionId,
          entryId: event.entryId,
          kind: event.kind,
          sensitivePath: Boolean(event.safety?.sensitivePath),
          secretDetected: Boolean(event.safety?.secretDetected),
          redacted: Boolean(event.safety?.redacted),
          summary: event.summary,
        });
      }
    }

    for (const warning of result.warnings ?? []) {
      warningRows.push({
        sessionId: result.sessionId,
        entryId: warning.entryId,
        code: warning.code,
        message: warning.message,
      });
    }
  }

  const generatedIso = generatedAt.toISOString();
  const runScope = boundedRunSummary(analysisRun, results.length);
  const lines = [];
  lines.push(`# Pi Harness Report — ${generatedIso.slice(0, 10)}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Project: \`${project.projectKey}\``);
  lines.push(`- Project root: \`${project.projectRoot}\``);
  lines.push(`- Generated at: ${generatedIso}`);
  if (runScope) {
    lines.push(`- Analysis run: \`${runScope.runId}\``);
    lines.push(`- Selected fingerprint: \`${runScope.selectedFingerprint}\``);
    lines.push(`- Consumer status: ${runScope.consumerStatus}`);
    lines.push(`- Frozen scope: selected ${runScope.selectedCount}, accepted ${runScope.acceptedCount}, skipped ${runScope.skippedCount}`);
    if (runScope.consumerStatus === "partial") {
      lines.push(`- Scope warning: PARTIAL — ${runScope.skippedCount} frozen selected session(s) were skipped; no replacement population was discovered.`);
    } else if (runScope.consumerStatus === "observed_empty") {
      lines.push("- Scope observation: OBSERVED EMPTY — the frozen run selected zero eligible sessions.");
    }
  }
  lines.push(`- Sessions scanned: ${results.length}`);
  lines.push(`- User turns: ${totals.turns}`);
  lines.push(`- Assistant messages: ${totals.assistantMessages}`);
  lines.push(`- Tool calls: ${totals.toolCalls}`);
  lines.push(`- Tool errors: ${totals.toolErrors}`);
  lines.push(`- Bash commands: ${totals.bashCommands}`);
  lines.push(`- Bash failures: ${totals.bashFailures}`);
  lines.push(`- Compactions: ${totals.compactions}`);
  lines.push(`- Branch points: ${totals.branches}`);
  lines.push(`- Parser/normalizer warnings: ${warningRows.length}`);
  lines.push(`- Redacted events: ${totals.safety.redactedEvents}`);
  lines.push(`- Sensitive path events: ${totals.safety.sensitivePathEvents}`);
  lines.push(`- Estimated cost: ${formatNumber(totals.usage.costTotal)}`);
  if (findingsProjection) {
    lines.push(`- Findings ledger: ${findingsProjection.status} at revision ${findingsProjection.ledgerRevision}`);
    lines.push(`- Findings: ${findingsProjection.counts.total} total, ${findingsProjection.counts.active} active, ${findingsProjection.counts.completed} completed`);
  }
  lines.push("");

  if (findingsProjection?.markdown) {
    lines.push(findingsProjection.markdown.trimEnd());
    lines.push("");
  }

  lines.push("## Sessions");
  lines.push("| Session | Events | Turns | Tool calls | Tool errors | Bash failures | Warnings |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const result of results) {
    lines.push(`| ${escapeCell(shortId(result.sessionId))} | ${result.eventCount ?? ""} | ${result.metrics?.turns ?? 0} | ${result.metrics?.toolCalls ?? 0} | ${result.metrics?.toolErrors ?? 0} | ${result.metrics?.bashFailures ?? 0} | ${result.warnings?.length ?? 0} |`);
  }
  lines.push("");

  lines.push("## Top Tools");
  lines.push(recordTable(totals.topTools, "Tool", "Calls"));
  lines.push("");

  lines.push("## Models");
  lines.push(recordTable(totals.models, "Model", "Messages"));
  lines.push("");

  lines.push("## Usage");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| input | ${totals.usage.input} |`);
  lines.push(`| output | ${totals.usage.output} |`);
  lines.push(`| cacheRead | ${totals.usage.cacheRead} |`);
  lines.push(`| cacheWrite | ${totals.usage.cacheWrite} |`);
  lines.push(`| totalTokens | ${totals.usage.totalTokens} |`);
  lines.push(`| costTotal | ${formatNumber(totals.usage.costTotal)} |`);
  lines.push("");

  lines.push("## Tool Failures");
  lines.push(toolFailures.size ? mapTable(toolFailures, "Tool", "Errors") : "No tool failures found in active paths.");
  lines.push("");

  lines.push("## Bash Failures");
  if (bashFailures.length) {
    lines.push("| Session | Entry | Exit | Command | Evidence |");
    lines.push("|---|---|---:|---|---|");
    for (const failure of bashFailures.slice(0, 20)) {
      lines.push(`| ${escapeCell(shortId(failure.sessionId))} | ${escapeCell(failure.entryId)} | ${failure.exitCode ?? ""} | ${escapeCell(failure.command)} | ${escapeCell(failure.excerpt)} |`);
    }
  } else {
    lines.push("No bash failures found in active paths.");
  }
  lines.push("");

  lines.push("## Warnings");
  if (warningRows.length) {
    lines.push("| Session | Entry | Code | Message |");
    lines.push("|---|---|---|---|");
    for (const warning of warningRows.slice(0, 50)) {
      lines.push(`| ${escapeCell(shortId(warning.sessionId))} | ${escapeCell(warning.entryId)} | ${escapeCell(warning.code)} | ${escapeCell(warning.message)} |`);
    }
  } else {
    lines.push("No parser/normalizer warnings found.");
  }
  lines.push("");

  lines.push("## Safety Findings");
  if (safetyFindings.length) {
    lines.push("| Session | Entry | Kind | Sensitive path | Secret detected | Redacted | Summary |");
    lines.push("|---|---|---|---:|---:|---:|---|");
    for (const finding of safetyFindings.slice(0, 30)) {
      lines.push(`| ${escapeCell(shortId(finding.sessionId))} | ${escapeCell(finding.entryId)} | ${escapeCell(finding.kind)} | ${yesNo(finding.sensitivePath)} | ${yesNo(finding.secretDetected)} | ${yesNo(finding.redacted)} | ${escapeCell(finding.summary)} |`);
    }
  } else {
    lines.push("No safety findings found in normalized active-path events.");
  }
  lines.push("");

  lines.push("## Report Evidence Boundary");
  lines.push("- Session metrics and diagnostics come from the frozen normalized report population.");
  lines.push("- The Findings section is a reader-safe presentation of the caller-supplied private canonical ledger; report generation does not infer findings or evidence states from session counts.");
  lines.push("- This private operational report is not a shareable export. The Findings section itself omits private locators, raw evidence, prompts, and commands.");
  lines.push("");

  return lines.join("\n");
}

export function writeProjectReport({ config, project, markdown, now = new Date() }) {
  const reportsDir = path.join(projectCacheDir(resolveHarnessHome(config), project.projectKey), "reports");
  ensureDir(reportsDir);

  const latestPath = path.join(reportsDir, "latest.md");
  const datedPath = path.join(reportsDir, `${now.toISOString().slice(0, 10)}-session-report.md`);
  atomicWriteFile(latestPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  atomicWriteFile(datedPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);

  return { reportsDir, latestPath, datedPath };
}

function boundedRunSummary(analysisRun, acceptedFallback) {
  if (!analysisRun) return undefined;
  return {
    runId: analysisRun.runId,
    selectedFingerprint: analysisRun.selection?.selectedFingerprint,
    selectedCount: analysisRun.selection?.selectedCount ?? 0,
    acceptedCount: analysisRun.consumption?.acceptedCount ?? acceptedFallback,
    skippedCount: analysisRun.consumption?.skippedCount ?? 0,
    consumerStatus: analysisRun.consumption?.status ?? analysisRun.laneStatus?.consumer ?? "pending",
  };
}

function readJsonlSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createEmptyTotals() {
  return {
    turns: 0,
    assistantMessages: 0,
    userMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
    bashCommands: 0,
    bashFailures: 0,
    compactions: 0,
    branches: 0,
    modelChanges: 0,
    thinkingChanges: 0,
    labels: {},
    models: {},
    topTools: {},
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0 },
    safety: { sensitivePathEvents: 0, secretDetectedEvents: 0, redactedEvents: 0 },
  };
}

function addMetrics(total, metrics = {}) {
  for (const key of ["turns", "assistantMessages", "userMessages", "toolCalls", "toolResults", "toolErrors", "bashCommands", "bashFailures", "compactions", "branches", "modelChanges", "thinkingChanges"]) {
    total[key] += metrics[key] ?? 0;
  }
  addRecord(total.labels, metrics.labels);
  addRecord(total.models, metrics.models);
  addRecord(total.topTools, metrics.topTools);
  for (const key of Object.keys(total.usage)) total.usage[key] += metrics.usage?.[key] ?? 0;
  for (const key of Object.keys(total.safety)) total.safety[key] += metrics.safety?.[key] ?? 0;
}

function addRecord(total, record = {}) {
  for (const [key, value] of Object.entries(record ?? {})) total[key] = (total[key] ?? 0) + value;
}

function recordTable(record, nameHeader, countHeader) {
  const entries = Object.entries(record ?? {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `No ${nameHeader.toLowerCase()} data.`;
  const lines = [`| ${nameHeader} | ${countHeader} |`, "|---|---:|"];
  for (const [key, value] of entries) lines.push(`| ${escapeCell(key)} | ${value} |`);
  return lines.join("\n");
}

function mapTable(map, nameHeader, countHeader) {
  return recordTable(Object.fromEntries([...map.entries()]), nameHeader, countHeader);
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? "";
}

function shortId(value) {
  if (!value) return "";
  const text = String(value);
  return text.length <= 12 ? text : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .slice(0, 240);
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function yesNo(value) {
  return value ? "yes" : "no";
}
