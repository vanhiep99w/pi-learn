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
      const reason = `parser_warning:${warning.code ?? "unknown"}`;
      candidates.push({
        score: 95,
        source: "warning",
        sessionId: warning.sessionId ?? result.sessionId,
        sessionFile: warning.sessionFile ?? result.sessionFile,
        entryId: warning.entryId,
        timestamp: warning.timestamp,
        kind: warning.code ?? "warning",
        reason,
        excerpt: warning.message,
        ...targetHintsForEvidence({ reason, kind: warning.code ?? "warning" }),
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
          ...targetHintsForEvidence({ reason: reason.reason, kind: event.kind, toolName: event.tool?.name, excerpt: firstNonEmpty(event.excerpt, event.summary, event.bash?.errorLines?.join(" | ")) }),
        });
      }
    }
  }

  const seen = new Set();
  const deduped = candidates
    .map((item) => sanitizeEvidence(item, maxExcerptChars))
    .filter((item) => {
      const key = `${item.sessionId}:${item.entryId}:${item.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  return pickBalancedEvidence(deduped, maxEvents);
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
      target: "memory|rules|parser|redaction|docs|eval|agents|skill|tool",
      targetFiles: ["relative/path"],
      risk: "low|medium|high",
      problem: "Evidence-backed problem statement",
      proposedChange: "Concrete change to make",
      evidence: [{ sessionId: "...", entryId: "...", kind: "tool_result|assistant_message|user_message|warning", reason: "...", excerpt: "short redacted excerpt or summary" }],
      testPlan: ["Concrete command or verification"],
      rollbackPlan: "How to undo the change",
    }],
  }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Reject a proposal if it lacks evidence refs, target files, risk, test plan, or rollback plan.");
  lines.push("Use the original evidence kind/reason/excerpt when citing evidence; do not put diagnostic prose in `kind`.");
  lines.push("");
  lines.push("## Target routing guide");
  lines.push("Choose the least risky target that fits the evidence and target files:");
  lines.push("- memory: stable project facts, preferences, or decisions worth remembering; not one-off details or secrets.");
  lines.push("- rules: deterministic detector/config/code for repeated patterns; target files should be harness/rules/** or src/analysis/rules/**, not only AGENTS.md.");
  lines.push("- agents: short project instruction/checklist for coding agents; target file is usually AGENTS.md.");
  lines.push("- skill: repeated multi-step workflow too long for AGENTS.md; target files should be skills/**/SKILL.md or an explicit skill path.");
  lines.push("- docs: repeated conceptual confusion or project documentation gap; target files should be docs/** or README.md.");
  lines.push("- parser: repeated parser/normalizer warnings or Pi session format drift; target parser/normalizer code and tests.");
  lines.push("- redaction: unredacted secret/token/path pattern or sensitive policy gap; target redaction code/tests. Use agents/docs for safety notes only.");
  lines.push("- eval: regression scenario for a known failure or accepted proposal; target harness/evals/** or eval fixtures.");
  lines.push("- tool: tool/extension wrapper behavior change; do not use tool for AGENTS.md workflow notes.");
  lines.push("Priority when several targets fit: docs/memory → agents → rules/skill → eval → tool → parser/redaction.");
  lines.push("Use each evidence item's likelyTargets/targetGuidance when present; if targetFiles are only AGENTS.md, prefer target=agents.");
  if (!project?.gitRoot) {
    lines.push("Project root has no enclosing git repository. Prefer proposal changes that can be reviewed manually, and mention if target files are outside nested service repos.");
  }
  lines.push("");
  lines.push("## Project");
  lines.push("```json");
  lines.push(JSON.stringify({
    projectKey: safeProject.projectKey,
    projectRoot: safeProject.projectRoot,
    gitRoot: safeProject.gitRoot,
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
  const targetFiles = redacted.targetFiles.map(String);
  const target = normalizeProposalTarget(String(redacted.target), targetFiles);
  const evidence = redacted.evidence.map((item) => ({
    sessionId: item.sessionId,
    entryId: item.entryId,
    kind: item.kind ?? "llm_reflection",
    reason: item.reason,
    excerpt: truncateString(String(item.excerpt ?? item.reason ?? ""), 500).value,
  }));
  return {
    ruleId: "LLM-REFLECT",
    title: String(redacted.title),
    target,
    targetFiles,
    risk: redacted.risk,
    problem: String(redacted.problem),
    proposedChange: String(redacted.proposedChange),
    testPlan: redacted.testPlan.map(String),
    rollbackPlan: String(redacted.rollbackPlan),
    evidence,
    status: "draft",
    createdAt: new Date().toISOString(),
    fingerprint: stableHash(["LLM-REFLECT", project?.projectKey, redacted.title, target, evidence.map((item) => `${item.sessionId}:${item.entryId}:${item.kind}:${item.reason ?? ""}`).join("|")].join("|")),
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

function pickBalancedEvidence(items, maxEvents) {
  const limit = Number(maxEvents) || DEFAULT_MAX_EVENTS;
  const perReasonLimit = Math.max(3, Math.ceil(limit * 0.3));
  const selected = [];
  const reasonCounts = new Map();

  for (const item of items) {
    const reason = item.reason ?? "unknown";
    const count = reasonCounts.get(reason) ?? 0;
    if (count < perReasonLimit) {
      selected.push(item);
      reasonCounts.set(reason, count + 1);
    }
    if (selected.length >= limit) return selected;
  }

  return selected;
}

function normalizeProposalTarget(target, targetFiles) {
  const files = targetFiles.map((file) => String(file));
  const onlyAgents = files.length > 0 && files.every((file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"));
  const hasDocs = files.some((file) => file.startsWith("docs/") || file.endsWith(".md"));
  const hasHarnessRule = files.some((file) => file.includes("harness/rules/") || file.includes("src/analysis/rules"));
  const hasRedactionCode = files.some((file) => file.includes("redaction") || file.includes("safety/"));

  if (onlyAgents && ["rules", "redaction", "tool"].includes(target)) return "agents";
  if (target === "rules" && !hasHarnessRule && onlyAgents) return "agents";
  if (target === "redaction" && !hasRedactionCode && onlyAgents) return "agents";
  if (target === "tool" && !files.some((file) => file.includes("tools") || file.includes("extensions")) && onlyAgents) return "agents";
  if (target === "docs" || (hasDocs && !hasHarnessRule && !hasRedactionCode)) return target;
  return target;
}

function targetHintsForEvidence({ reason, kind, toolName, excerpt }) {
  const text = String(excerpt ?? "");
  if (String(reason).startsWith("parser_warning:")) {
    return {
      likelyTargets: ["parser", "rules", "eval"],
      targetGuidance: "Use parser for session format/normalizer fixes; use rules only for detector tuning; add eval if this should become regression coverage.",
    };
  }
  if (reason === "tool_error:edit") {
    return {
      likelyTargets: ["agents", "rules", "eval"],
      targetGuidance: "Prefer agents for exact-text edit workflow guidance; use rules only if adding detector config/code; add eval for repeated regression coverage.",
    };
  }
  if (reason === "tool_error:bash" || reason === "bash_failure") {
    const gradlePermission = /gradlew.*permission denied|permission denied.*gradlew/i.test(text);
    return {
      likelyTargets: gradlePermission ? ["agents", "rules"] : ["agents", "rules", "eval"],
      targetGuidance: gradlePermission
        ? "Prefer agents for a Gradle wrapper fallback note; use rules only if adding a detector for repeated wrapper permission failures."
        : "Prefer agents for command checklist guidance; use rules for deterministic repeated failure detection; use eval for known regression coverage.",
    };
  }
  if (reason === "safety_sensitive") {
    return {
      likelyTargets: ["redaction", "agents"],
      targetGuidance: "Use redaction only for missing redaction code/tests; use agents/docs for safe handling notes when values are already redacted.",
    };
  }
  if (reason === "user_correction") {
    return {
      likelyTargets: ["memory", "agents", "docs"],
      targetGuidance: "Use memory for stable repeated facts/preferences; agents for short workflow rules; docs for repeated conceptual confusion.",
    };
  }
  if (reason === "compaction") {
    return {
      likelyTargets: ["memory", "agents", "eval"],
      targetGuidance: "Use memory for stable context facts, agents for handoff/checklist rules, eval for long-session regression coverage.",
    };
  }
  if (kind === "assistant_message" && /workflow|checklist|profile|guide|step|bước|quy trình/i.test(text)) {
    return {
      likelyTargets: ["docs", "memory", "skill"],
      targetGuidance: "Use docs for repeated explanations, memory for stable facts, and skill for repeated multi-step workflows.",
    };
  }
  return {
    likelyTargets: ["agents", "docs"],
    targetGuidance: `Use the target routing guide; do not choose ${toolName ? `tool for ${toolName} notes` : "tool/rules/redaction"} unless target files match that component.`,
  };
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
