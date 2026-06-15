import crypto from "node:crypto";

export function getAutomationStatus(config) {
  const policy = validateAutomationPolicy(config);
  return {
    enabled: Boolean(config.automation?.enabled),
    allowed: Boolean(config.automation?.enabled) && policy.ok,
    reason: !config.automation?.enabled ? "automation_disabled" : policy.reason,
    automation: {
      maxSessions: config.automation?.maxSessions ?? 5,
      scan: config.automation?.scan !== false,
      report: config.automation?.report !== false,
      proposeRules: config.automation?.proposeRules !== false,
      proposeTargets: Array.isArray(config.automation?.proposeTargets) ? config.automation.proposeTargets : [],
      eval: config.automation?.eval !== false,
      createEvalFixtureDraft: config.automation?.createEvalFixtureDraft !== false,
    },
    policy,
  };
}

export function validateAutomationPolicy(config) {
  if (config.autoApply) return { ok: false, reason: "autoApply_must_remain_false" };
  if (config.autoPush) return { ok: false, reason: "autoPush_must_remain_false" };
  if (config.riskPolicy?.lowRiskAutoPatch) return { ok: false, reason: "lowRiskAutoPatch_must_remain_false" };
  if (config.riskPolicy?.requireHumanApproval === false) return { ok: false, reason: "requireHumanApproval_must_remain_true" };
  return { ok: true, reason: "ok" };
}

export function createEvalFixtureDraftProposal({ project, evalResult, reportResult }) {
  const failed = evalResult?.summary?.failed ?? 0;
  const scenarios = (evalResult?.results ?? []).map((result) => `${result.scenario}:${result.status}`).join(", ");
  return {
    ruleId: "AUTO-EVAL-FIXTURE",
    title: "Create eval fixture from gated automation signals",
    target: "eval",
    targetFiles: ["harness/evals/", "packages/harness-runtime/tests/"],
    risk: "low",
    problem: "Gated automation can safely draft eval fixture work after scan/report/proposal generation, but should not apply changes automatically.",
    proposedChange: "Review latest normalized evidence and add or update a deterministic eval fixture only if it covers a repeated regression risk.",
    testPlan: [
      "Run `/harness-eval` in Pi.",
      "Run `npm --prefix packages/harness-runtime test` before committing runtime changes.",
    ],
    rollbackPlan: "Remove the eval fixture draft or revert the fixture commit if it adds noise.",
    evidence: [{
      sessionId: "automation",
      entryId: "eval-latest",
      kind: "gated_automation",
      excerpt: `Eval failed=${failed}; scenarios=${scenarios || "none"}; report=${reportResult?.report?.latestPath ?? "not generated"}`,
    }],
    status: "draft",
    createdAt: new Date().toISOString(),
    fingerprint: stableHash(["AUTO-EVAL-FIXTURE", project.projectKey, scenarios || "no-scenarios"].join("|")),
  };
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}
