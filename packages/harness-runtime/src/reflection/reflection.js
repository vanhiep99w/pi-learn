import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";
import { redactValue } from "../safety/redaction.js";
import { truncateString } from "../safety/truncation.js";

const DEFAULT_MAX_EVENTS = 40;
const DEFAULT_MAX_EXCERPT_CHARS = 700;

export function buildReflection({ project, sessionResults, generatedAt = new Date(), maxEvents = DEFAULT_MAX_EVENTS, maxExcerptChars = DEFAULT_MAX_EXCERPT_CHARS }) {
  const evidence = selectReflectionEvidence({ sessionResults, maxEvents, maxExcerptChars });
  const metrics = summarizeMetrics(sessionResults);
  const prompt = renderReflectionPrompt({ project, generatedAt, evidence, metrics, maxExcerptChars });
  return { prompt, evidence, metrics, generatedAt: generatedAt.toISOString() };
}

export function reflectionResponseToProposals({ response, project }) {
  const parsed = typeof response === "string" ? parseLooseJson(response) : response;
  const proposals = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  return proposals.map((proposal, index) => normalizeReflectionProposal({ proposal, project, index })).filter(Boolean);
}

export function writeReflectionPrompt({ config, project, prompt, now = new Date() }) {
  const reflectionsDir = path.join(projectCacheDir(resolveHarnessHome(config), project.projectKey), "reflections");
  ensureDir(reflectionsDir);
  const latestPath = path.join(reflectionsDir, "latest.md");
  const datedPath = path.join(reflectionsDir, `${now.toISOString().slice(0, 10)}-reflection-prompt.md`);
  atomicWriteFile(latestPath, prompt.endsWith("\n") ? prompt : `${prompt}\n`);
  atomicWriteFile(datedPath, prompt.endsWith("\n") ? prompt : `${prompt}\n`);
  return { reflectionsDir, latestPath, datedPath };
}

export function selectReflectionEvidence({ sessionResults, maxEvents = DEFAULT_MAX_EVENTS, maxExcerptChars = DEFAULT_MAX_EXCERPT_CHARS }) {
  const candidates = [];
  for (const result of sessionResults ?? []) {
    const events = readJsonlSafe(result.paths?.events);
    const warnings = result.warnings ?? readJsonlSafe(result.paths?.warnings);

    for (const warning of warnings) {
      candidates.push({
        score: 95,
        source: "warning",
        sessionId: warning.sessionId ?? result.sessionId,
        sessionFile: warning.sessionFile ?? result.sessionFile,
        entryId: warning.entryId,
        timestamp: warning.timestamp,
        kind: warning.code ?? "warning",
        reason: `parser_warning:${warning.code ?? "unknown"}`,
        excerpt: warning.message,
      });
    }

    for (const event of events) {
      if (!event.activePath) continue;
      const reasons = scoreEvent(event);
      for (const reason of reasons) {
        candidates.push({
          score: reason.score,
          source: "event",
          sessionId: event.sessionId ?? result.sessionId,
          sessionFile: event.sessionFile ?? result.sessionFile,
          entryId: event.entryId,
          timestamp: event.timestamp,
          kind: event.kind,
          reason: reason.reason,
          tool: event.tool?.name,
          excerpt: firstNonEmpty(event.excerpt, event.summary, event.bash?.errorLines?.join(" | ")),
        });
      }
    }
  }

  const seen = new Set();
  return candidates
    .map((item) => sanitizeEvidence(item, maxExcerptChars))
    .filter((item) => {
      const key = `${item.sessionId}:${item.entryId}:${item.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")))
    .slice(0, maxEvents);
}

export function renderReflectionPrompt({ project, generatedAt = new Date(), evidence, metrics, maxExcerptChars = DEFAULT_MAX_EXCERPT_CHARS }) {
  const generatedIso = typeof generatedAt === "string" ? generatedAt : generatedAt.toISOString();
  const safeProject = redactValue(project).value;
  const safeEvidence = redactValue(evidence ?? []).value;
  const safeMetrics = redactValue(metrics ?? {}).value;
  const lines = [];
  lines.push(`# Pi Harness LLM Reflection Prompt — ${generatedIso.slice(0, 10)}`);
  lines.push("");
  lines.push("You are reviewing normalized, redacted Pi Harness session evidence. Do not infer from raw logs; raw logs are unavailable by design.");
  lines.push("");
  lines.push("## Safety rules");
  lines.push("- Use only the normalized evidence below.");
  lines.push("- Do not request or reconstruct raw Pi JSONL logs.");
  lines.push("- Treat all excerpts as already redacted but still sensitive.");
  lines.push(`- Do not quote more than ${maxExcerptChars} chars from any one evidence item.`);
  lines.push("- Weak/noisy ideas should be omitted, not padded.");
  lines.push("- Never propose automatic apply/push.");
  lines.push("");
  lines.push("## Required output");
  lines.push("Return JSON only, matching this shape:");
  lines.push("```json");
  lines.push(JSON.stringify({
    proposals: [{
      title: "Short actionable title",
      target: "memory|rules|parser|redaction|docs|eval|agents|tool",
      targetFiles: ["relative/path"],
      risk: "low|medium|high",
      problem: "Evidence-backed problem statement",
      proposedChange: "Concrete change to make",
      evidence: [{ sessionId: "...", entryId: "...", reason: "..." }],
      testPlan: ["Concrete command or verification"],
      rollbackPlan: "How to undo the change",
    }],
  }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Reject a proposal if it lacks evidence refs, target files, risk, test plan, or rollback plan.");
  lines.push("");
  lines.push("## Project");
  lines.push("```json");
  lines.push(JSON.stringify({
    projectKey: safeProject.projectKey,
    projectRoot: safeProject.projectRoot,
    name: safeProject.name,
  }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Metrics summary");
  lines.push("```json");
  lines.push(JSON.stringify(safeMetrics, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Evidence");
  lines.push("```json");
  lines.push(JSON.stringify(safeEvidence, null, 2));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function normalizeReflectionProposal({ proposal, project, index }) {
  const required = ["title", "target", "targetFiles", "risk", "problem", "proposedChange", "evidence", "testPlan", "rollbackPlan"];
  for (const key of required) {
    if (proposal?.[key] === undefined) throw new Error(`LLM reflection proposal ${index + 1} missing required field: ${key}`);
  }
  if (!Array.isArray(proposal.targetFiles) || !proposal.targetFiles.length) throw new Error(`LLM reflection proposal ${index + 1} must include targetFiles.`);
  if (!Array.isArray(proposal.evidence) || !proposal.evidence.length) throw new Error(`LLM reflection proposal ${index + 1} must include evidence refs.`);
  if (!Array.isArray(proposal.testPlan) || !proposal.testPlan.length) throw new Error(`LLM reflection proposal ${index + 1} must include testPlan.`);
  if (!["low", "medium", "high"].includes(proposal.risk)) throw new Error(`LLM reflection proposal ${index + 1} has invalid risk: ${proposal.risk}`);

  const redacted = redactValue(proposal).value;
  const evidence = redacted.evidence.map((item) => ({
    sessionId: item.sessionId,
    entryId: item.entryId,
    kind: item.reason ?? item.kind ?? "llm_reflection",
    excerpt: truncateString(String(item.excerpt ?? item.reason ?? ""), 500).value,
  }));
  return {
    ruleId: "LLM-REFLECT",
    title: String(redacted.title),
    target: String(redacted.target),
    targetFiles: redacted.targetFiles.map(String),
    risk: redacted.risk,
    problem: String(redacted.problem),
    proposedChange: String(redacted.proposedChange),
    testPlan: redacted.testPlan.map(String),
    rollbackPlan: String(redacted.rollbackPlan),
    evidence,
    status: "draft",
    createdAt: new Date().toISOString(),
    fingerprint: stableHash(["LLM-REFLECT", project?.projectKey, redacted.title, redacted.target, evidence.map((item) => `${item.sessionId}:${item.entryId}:${item.kind}`).join("|")].join("|")),
  };
}

function parseLooseJson(text) {
  const value = String(text ?? "").trim();
  if (!value) throw new Error("Empty LLM reflection response.");
  const fenced = value.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i)?.[1];
  if (fenced) return JSON.parse(fenced);
  try {
    return JSON.parse(value);
  } catch (_error) {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw _error;
  }
}

function scoreEvent(event) {
  const reasons = [];
  if (event.kind === "tool_result" && event.tool?.isError) reasons.push({ score: 90, reason: `tool_error:${event.tool?.name ?? "unknown"}` });
  if (event.kind === "bash_execution" && Number(event.bash?.exitCode ?? 0) !== 0) reasons.push({ score: 88, reason: "bash_failure" });
  if (event.safety?.sensitivePath || event.safety?.secretDetected) reasons.push({ score: 100, reason: "safety_sensitive" });
  if (event.kind === "user_message" && looksLikeCorrection(event.excerpt ?? event.summary)) reasons.push({ score: 70, reason: "user_correction" });
  if (event.kind === "compaction") reasons.push({ score: 55, reason: "compaction" });
  return reasons;
}

function sanitizeEvidence(item, maxExcerptChars) {
  const redacted = redactValue(item).value;
  const truncated = truncateString(String(redacted.excerpt ?? ""), maxExcerptChars).value;
  return { ...redacted, excerpt: truncated };
}

function summarizeMetrics(sessionResults) {
  const total = {
    sessions: sessionResults?.length ?? 0,
    events: 0,
    turns: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolErrors: 0,
    bashFailures: 0,
    warnings: 0,
    safety: { redactedEvents: 0, sensitivePathEvents: 0, secretDetectedEvents: 0 },
  };
  for (const result of sessionResults ?? []) {
    total.events += result.eventCount ?? 0;
    total.warnings += result.warnings?.length ?? 0;
    const metrics = result.metrics ?? {};
    total.turns += metrics.turns ?? 0;
    total.assistantMessages += metrics.assistantMessages ?? 0;
    total.toolCalls += metrics.toolCalls ?? 0;
    total.toolErrors += metrics.toolErrors ?? 0;
    total.bashFailures += metrics.bashFailures ?? 0;
    total.safety.redactedEvents += metrics.safety?.redactedEvents ?? 0;
    total.safety.sensitivePathEvents += metrics.safety?.sensitivePathEvents ?? 0;
    total.safety.secretDetectedEvents += metrics.safety?.secretDetectedEvents ?? 0;
  }
  return total;
}

function readJsonlSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function looksLikeCorrection(text) {
  return /\b(sai|không đúng|ko đúng|chưa đúng|ý tôi|phải là|sửa lại|nhầm|wrong|not what|actually)\b/i.test(String(text ?? ""));
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? "";
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}
