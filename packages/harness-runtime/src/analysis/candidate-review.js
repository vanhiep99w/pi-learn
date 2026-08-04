import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inventoryProjectAgentAssets, publicAgentAssetInventory } from "./project-agent-assets.js";

const CANDIDATE_FIELDS = [
  "schemaVersion", "id", "detectorId", "kind", "status", "scope", "signal", "count",
  "evidenceRefs", "likelyDimensions", "requiredReview",
];
const PROPOSAL_ONLY_FIELDS = ["title", "targetFiles", "proposedChange", "testPlan", "rollbackPlan", "problem", "risk"];

const PARSER_WARNING_REVIEWS = {
  malformed_json: parserReview(
    "Malformed session lines are skipped, which can make normalized evidence incomplete.",
    ["packages/harness-runtime/src/session/parse-session.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  session_header_not_first: parserReview(
    "A displaced session header changes parser structure diagnostics and can weaken session identity handling.",
    ["packages/harness-runtime/src/session/parse-session.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  duplicate_session_header: parserReview(
    "Multiple session headers create conflicting session identity evidence.",
    ["packages/harness-runtime/src/session/parse-session.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  missing_id: parserReview(
    "Entries without IDs cannot participate reliably in tree and evidence references.",
    ["packages/harness-runtime/src/session/parse-session.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  missing_header: parserReview(
    "A missing session header prevents reliable session identity binding.",
    ["packages/harness-runtime/src/session/parse-session.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  duplicate_id: parserReview(
    "Duplicate entry IDs make parent and evidence references ambiguous.",
    ["packages/harness-runtime/src/session/tree.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  missing_parent: parserReview(
    "A missing parent breaks a complete conversation ancestry path.",
    ["packages/harness-runtime/src/session/tree.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  parent_cycle: parserReview(
    "A parent cycle prevents a reliable active-path traversal.",
    ["packages/harness-runtime/src/session/tree.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  unknown_entry_type: parserReview(
    "Unknown entries are retained but lack explicit normalized handling, so downstream evidence can omit their semantics.",
    ["packages/harness-runtime/src/session/warnings.js", "packages/harness-runtime/src/normalize/events.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
  unknown_message_role: parserReview(
    "Unknown message roles lack explicit normalized handling and may be omitted from role-specific evidence.",
    ["packages/harness-runtime/src/session/warnings.js", "packages/harness-runtime/src/normalize/events.js", "packages/harness-runtime/tests/parse-tree.test.js"],
  ),
};

export function reviewCandidateSignals({ project, candidates = [], assetLimits } = {}) {
  if (!project?.projectRoot) throw new Error("reviewCandidateSignals requires a project root");
  const ruleCandidates = candidates.filter((candidate) => candidate?.detectorId === "R-0001" || candidate?.detectorId === "R-0002");
  const ownerRoutes = [...new Set(ruleCandidates.flatMap((candidate) => candidate.scope?.ownerRoutes ?? []))].sort();
  const assetLane = inventoryProjectAgentAssets({ projectRoot: project.projectRoot, ownerRoutes, limits: assetLimits });
  const decisions = candidates.map((candidate) => reviewCandidate({ project, candidate, assetLane }));
  const proposals = decisions.filter((decision) => decision.state === "promoted").map((decision) => decision.proposal);
  return { candidates, decisions, proposals, assetLane };
}

export function publicCandidateSignalSummary(candidate) {
  return {
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    detectorId: candidate.detectorId,
    kind: candidate.kind,
    status: candidate.status,
    scope: {
      authority: candidate.scope?.authority,
      ownerRoutes: candidate.scope?.ownerRoutes ?? [],
    },
    count: candidate.count,
    evidenceRefCount: candidate.evidenceRefs?.length ?? 0,
    likelyDimensions: candidate.likelyDimensions ?? [],
    requiredReview: candidate.requiredReview ?? [],
  };
}

export function publicCandidateDecision(decision) {
  return {
    candidateId: decision.candidateId,
    detectorId: decision.detectorId,
    state: decision.state,
    reasonCode: decision.reasonCode,
    observedUse: decision.observedUse,
    coverage: decision.coverage,
    ownerRoutes: decision.ownerRoutes,
    validationRoute: decision.validationRoute,
    reviewFingerprint: decision.reviewFingerprint,
    diagnostics: decision.diagnostics,
    proposalFingerprint: decision.proposal?.fingerprint,
  };
}

export function publicCandidateReview(review) {
  return {
    candidates: review.candidates.length,
    promoted: review.decisions.filter((item) => item.state === "promoted").length,
    deferred: review.decisions.filter((item) => item.state === "deferred").length,
    rejected: review.decisions.filter((item) => item.state === "rejected").length,
    candidateSignals: review.candidates.map(publicCandidateSignalSummary),
    decisions: review.decisions.map(publicCandidateDecision),
    agentAssets: publicAgentAssetInventory(review.assetLane),
  };
}

function reviewCandidate({ project, candidate, assetLane }) {
  const invalid = validateCandidate(candidate);
  if (invalid.length) {
    return finalizeDecision(candidate, {
      state: "rejected",
      reasonCode: "not-applicable",
      observedUse: "unobserved",
      coverage: { state: "not-applicable", matches: [] },
      ownerRoutes: safeOwnerRoutes(candidate),
      diagnostics: invalid.map((code) => ({ code })),
    }, []);
  }
  if (candidate.scope.authority?.project !== true || candidate.scope.authority?.userHome !== false) {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "outside-authority",
      observedUse: "unobserved",
      coverage: { state: "not-applicable", matches: [] },
      ownerRoutes: safeOwnerRoutes(candidate),
      diagnostics: [{ code: "project-only-authority-required" }],
    }, []);
  }

  switch (candidate.detectorId) {
    case "R-0001":
      return reviewRulesCandidate({ candidate, assetLane, signature: "bash-prerequisite-retry" });
    case "R-0002":
      if (candidate.signal?.toolName !== "edit" || candidate.signal?.errorKind !== "oldText_mismatch") {
        return finalizeDecision(candidate, {
          state: "rejected",
          reasonCode: "not-applicable",
          observedUse: "unobserved",
          coverage: { state: "not-applicable", matches: [] },
          ownerRoutes: safeOwnerRoutes(candidate),
          diagnostics: [{ code: "no-high-precision-rule-signature" }],
        }, []);
      }
      return reviewRulesCandidate({ candidate, assetLane, signature: "exact-text-edit-workflow" });
    case "R-0003":
      return finalizeDecision(candidate, {
        state: "deferred",
        reasonCode: "no-observed-consequence",
        observedUse: "unobserved",
        coverage: { state: "not-applicable", matches: [] },
        ownerRoutes: [],
        diagnostics: [{ code: "authorization-and-exposure-unresolved" }],
      }, []);
    case "R-0004":
      return reviewParserCandidate({ project, candidate });
    default:
      return finalizeDecision(candidate, {
        state: "rejected",
        reasonCode: "not-applicable",
        observedUse: "unobserved",
        coverage: { state: "not-applicable", matches: [] },
        ownerRoutes: safeOwnerRoutes(candidate),
        diagnostics: [{ code: "unknown-detector" }],
      }, []);
  }
}

function reviewRulesCandidate({ candidate, assetLane, signature }) {
  const ownerRoutes = safeOwnerRoutes(candidate);
  const relevantAssets = (assetLane.assets ?? []).filter((asset) => asset.appliesTo?.some((owner) => ownerRoutes.includes(owner)));
  const relevantDiagnostics = (assetLane.diagnostics ?? []).filter((item) => !item.route || relevantAssets.some((asset) => asset.route === item.route));
  const unavailable = relevantAssets.filter((asset) => !["opened", "absent"].includes(asset.state));
  const countLimited = (assetLane.diagnostics ?? []).some((item) => item.code === "asset-count-limit");
  const assetBindings = relevantAssets.map((asset) => ({ route: asset.route, state: asset.state, digest: asset.digest }));

  if (unavailable.length || relevantDiagnostics.length || countLimited || assetLane.status === "failed") {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "unobserved-owner",
      observedUse: "unobserved",
      coverage: { state: "partial", matches: [] },
      ownerRoutes,
      diagnostics: [
        ...unavailable.map((asset) => ({ code: asset.state, route: asset.route })),
        ...relevantDiagnostics,
        ...(countLimited ? [{ code: "asset-count-limit" }] : []),
      ],
    }, assetBindings);
  }

  const coverage = evaluateCoverage(relevantAssets, signature);
  if (coverage.state === "covered") {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "existing-coverage",
      observedUse: "unobserved",
      coverage,
      ownerRoutes,
      diagnostics: [{ code: "applicable-semantic-coverage-found" }],
    }, assetBindings);
  }
  if (coverage.state === "ambiguous") {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "existing-coverage",
      observedUse: "unobserved",
      coverage,
      ownerRoutes,
      diagnostics: [{ code: "ambiguous-semantic-coverage" }],
    }, assetBindings);
  }
  if (!hasCompleteEvidence(candidate)) {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "no-observed-consequence",
      observedUse: "unobserved",
      coverage,
      ownerRoutes,
      diagnostics: [{ code: "incomplete-evidence-refs" }],
    }, assetBindings);
  }

  const proposal = signature === "exact-text-edit-workflow"
    ? exactEditProposal(candidate)
    : bashRetryProposal(candidate);
  return finalizeDecision(candidate, {
    state: "promoted",
    observedUse: "unobserved",
    coverage,
    ownerRoutes,
    validationRoute: "npm --prefix packages/harness-runtime test",
    diagnostics: [{ code: "bounded-deterministic-repair" }],
    proposal,
  }, assetBindings);
}

function reviewParserCandidate({ project, candidate }) {
  const warningCode = candidate.signal?.warningCode;
  const review = PARSER_WARNING_REVIEWS[warningCode];
  const coverage = { state: "not-applicable", matches: [] };
  if (!hasCompleteEvidence(candidate) || !candidate.evidenceRefs.every((ref) => ref.kind === warningCode)) {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "no-observed-consequence",
      observedUse: "unobserved",
      coverage,
      ownerRoutes: review?.targetFiles ?? [],
      diagnostics: [{ code: "incomplete-warning-evidence" }],
    }, []);
  }
  if (!review) {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: "unobserved-owner",
      observedUse: "unobserved",
      coverage,
      ownerRoutes: [],
      diagnostics: [{ code: "warning-owner-unmapped" }],
    }, []);
  }

  const ownerInspection = inspectProjectOwners(project.projectRoot, review.targetFiles);
  if (!ownerInspection.complete) {
    return finalizeDecision(candidate, {
      state: "deferred",
      reasonCode: ownerInspection.outsideAuthority ? "outside-authority" : "unobserved-owner",
      observedUse: "unobserved",
      coverage,
      ownerRoutes: review.targetFiles,
      diagnostics: ownerInspection.diagnostics,
    }, ownerInspection.bindings);
  }

  const proposal = parserProposal(candidate, review);
  return finalizeDecision(candidate, {
    state: "promoted",
    observedUse: "unobserved",
    coverage,
    ownerRoutes: review.targetFiles,
    validationRoute: "npm --prefix packages/harness-runtime test",
    diagnostics: [{ code: "distinct-warning-evidence-inspected", consequence: review.consequence }],
    proposal,
  }, ownerInspection.bindings);
}

function evaluateCoverage(assets, signature) {
  const covered = [];
  const ambiguous = [];
  for (const asset of assets) {
    if (asset.state !== "opened") continue;
    for (const block of asset.blocks ?? []) {
      const result = signature === "exact-text-edit-workflow" ? exactEditSignature(block) : bashRetrySignature(block);
      const row = { route: asset.route, sectionId: block.sectionId };
      if (result === "covered") covered.push(row);
      if (result === "ambiguous") ambiguous.push(row);
    }
  }
  if (covered.length) return { state: "covered", matches: covered };
  if (ambiguous.length) return { state: "ambiguous", matches: ambiguous };
  return { state: "not-covered", matches: [] };
}

function exactEditSignature(block) {
  const text = `${block.heading}\n${block.content}`;
  const concepts = [
    /\boldText\b/i.test(text) && /\b(?:edit|exact(?:-text)?)\b/i.test(text),
    /\b(?:read|re-read|reread|inspect)\b[\s\S]{0,100}\b(?:current|target)\b[\s\S]{0,80}\b(?:block|region|content)\b/i.test(text),
    /\bwhitespace\b/i.test(text) && /\bpunctuation\b/i.test(text),
    /\bmatch\b[\s\S]{0,40}\bunique(?:ly)?\b|\bunique(?:ly)?\b[\s\S]{0,40}\bmatch\b/i.test(text),
  ];
  return signatureState(concepts);
}

function bashRetrySignature(block) {
  const text = `${block.heading}\n${block.content}`;
  const concepts = [
    /\b(?:bash|command)\b/i.test(text),
    /\b(?:prerequisite|precondition|dependency|required setup)\b/i.test(text),
    /\b(?:inspect|read|review)\b[\s\S]{0,80}\b(?:failure|error|stderr|output)\b/i.test(text),
    /\bbefore\b[\s\S]{0,50}\bretr(?:y|ying|ies)\b|\bretr(?:y|ying|ies)\b[\s\S]{0,50}\bonly after\b/i.test(text),
  ];
  return signatureState(concepts);
}

function signatureState(concepts) {
  const count = concepts.filter(Boolean).length;
  if (count === concepts.length) return "covered";
  if (count >= 2) return "ambiguous";
  return "not-covered";
}

function exactEditProposal(candidate) {
  return proposalBase(candidate, {
    title: "Add edit workflow note for exact oldText matching",
    target: "rules",
    targetFiles: ["wiki/_rules.md"],
    risk: "low",
    problem: `Edit oldText mismatch occurred ${candidate.count} times in distinct inspected active-path evidence references, and bounded applicable project guidance was inspected without finding equivalent coverage.`,
    proposedChange: "Add a concise global prompt rule to inspect the current target block and keep oldText whitespace, punctuation, and uniqueness exact before editing.",
    testPlan: [
      "Review the prompt rule scope and ensure it does not encode executable detector parameters.",
      "Run `npm --prefix packages/harness-runtime test`.",
      "Run `/harness-eval existing-coverage-before-proposal`.",
    ],
    rollbackPlan: "Revert the prompt-rule patch if it duplicates applicable guidance or creates misleading edit workflow advice.",
  });
}

function bashRetryProposal(candidate) {
  const family = String(candidate.signal?.commandFamily ?? "bash").slice(0, 120);
  return proposalBase(candidate, {
    title: `Add checklist for repeated bash failure: ${family}`,
    target: "rules",
    targetFiles: ["wiki/operations/_rules.md"],
    risk: "low",
    problem: `Bash command family \`${family}\` failed ${candidate.count} times in distinct inspected active-path evidence references, and bounded applicable project guidance was inspected without finding equivalent coverage.`,
    proposedChange: "Add a concise operations rule requiring prerequisite checks and inspection of failure output before retrying a bash command.",
    testPlan: [
      "Review the new prompt rule for a narrow operations scope and false guidance.",
      "Run `npm --prefix packages/harness-runtime test`.",
      "Run `/harness-eval wiki-prompt-rule-section-routing`.",
    ],
    rollbackPlan: "Revert the prompt-rule patch if it creates noisy or overly broad command guidance.",
  });
}

function parserProposal(candidate, review) {
  const warningCode = candidate.signal.warningCode;
  return proposalBase(candidate, {
    title: `Improve parser handling for ${warningCode}`,
    target: "parser",
    targetFiles: review.targetFiles,
    risk: "medium",
    problem: `Parser warning \`${warningCode}\` appeared in ${candidate.count} distinct inspected evidence reference(s). ${review.consequence}`,
    proposedChange: "Add bounded explicit parser/normalizer handling or a focused fixture that documents and validates the expected warning behavior.",
    testPlan: [
      `Add a focused fixture for \`${warningCode}\`.`,
      "Run `npm --prefix packages/harness-runtime test`.",
    ],
    rollbackPlan: "Revert the parser/normalizer change if it weakens active-path, identity, or event normalization behavior.",
  });
}

function proposalBase(candidate, proposal) {
  return {
    ...proposal,
    ruleId: candidate.detectorId,
    evidence: candidate.evidenceRefs.map((ref) => ({ ...ref })),
    candidateId: candidate.id,
    detectorId: candidate.detectorId,
  };
}

function finalizeDecision(candidate, draft, assetBindings) {
  const fingerprintPayload = {
    candidateId: candidate?.id,
    detectorId: candidate?.detectorId,
    state: draft.state,
    reasonCode: draft.reasonCode ?? null,
    coverage: draft.coverage,
    ownerRoutes: draft.ownerRoutes ?? [],
    validationRoute: draft.validationRoute ?? null,
    diagnostics: draft.diagnostics ?? [],
    assetBindings,
  };
  const reviewFingerprint = sha256(canonicalJson(fingerprintPayload));
  const proposal = draft.proposal ? {
    ...draft.proposal,
    reviewFingerprint,
    fingerprint: sha256(canonicalJson({
      candidateId: candidate.id,
      detectorId: candidate.detectorId,
      target: draft.proposal.target,
      targetFiles: draft.proposal.targetFiles,
      proposedChange: draft.proposal.proposedChange,
    })),
  } : undefined;
  return {
    candidateId: candidate?.id,
    detectorId: candidate?.detectorId,
    state: draft.state,
    reasonCode: draft.reasonCode,
    observedUse: draft.observedUse,
    coverage: draft.coverage,
    ownerRoutes: draft.ownerRoutes ?? [],
    validationRoute: draft.validationRoute,
    reviewFingerprint,
    diagnostics: draft.diagnostics ?? [],
    assetBindings,
    proposal,
  };
}

function validateCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return ["invalid-candidate-shape"];
  if (candidate.schemaVersion !== 1) errors.push("invalid-candidate-schema");
  if (!/^candidate-[a-f0-9]{24}$/.test(String(candidate.id ?? ""))) errors.push("invalid-candidate-id");
  if (!/^R-000[1-4]$/.test(String(candidate.detectorId ?? ""))) errors.push("invalid-detector-id");
  if (candidate.status !== "lead") errors.push("invalid-candidate-status");
  if (!candidate.scope || typeof candidate.scope !== "object" || Array.isArray(candidate.scope)) errors.push("invalid-candidate-scope");
  if (!candidate.signal || typeof candidate.signal !== "object" || Array.isArray(candidate.signal)) errors.push("invalid-candidate-signal");
  if (!Number.isInteger(candidate.count) || candidate.count < 1) errors.push("invalid-candidate-count");
  if (!Array.isArray(candidate.evidenceRefs) || !Array.isArray(candidate.requiredReview) || !Array.isArray(candidate.likelyDimensions)) errors.push("invalid-candidate-arrays");
  for (const field of PROPOSAL_ONLY_FIELDS) if (Object.hasOwn(candidate, field)) errors.push(`proposal-field-${field}`);
  for (const field of Object.keys(candidate)) if (!CANDIDATE_FIELDS.includes(field)) errors.push(`unexpected-field-${field}`);
  return errors;
}

function hasCompleteEvidence(candidate) {
  if (!Number.isInteger(candidate.count) || candidate.count < 1) return false;
  if (candidate.evidenceRefs.length !== candidate.count) return false;
  const identities = new Set();
  for (const ref of candidate.evidenceRefs) {
    if (!ref
      || !/^[a-f0-9]{64}$/.test(String(ref.sourceFingerprint ?? ""))
      || typeof ref.sessionId !== "string" || !ref.sessionId
      || typeof ref.entryId !== "string" || !ref.entryId
      || typeof ref.kind !== "string" || !ref.kind) return false;
    identities.add(`${ref.sourceFingerprint}\0${ref.sessionId}\0${ref.entryId}\0${ref.eventId ?? ""}\0${ref.kind}`);
  }
  return identities.size === candidate.count;
}

function inspectProjectOwners(projectRoot, routes) {
  const root = path.resolve(projectRoot);
  const diagnostics = [];
  const bindings = [];
  let outsideAuthority = false;
  for (const route of routes) {
    if (!isProjectRoute(route)) {
      diagnostics.push({ code: "outside-authority", route: "<outside-project>" });
      outsideAuthority = true;
      continue;
    }
    const absolute = path.resolve(root, ...route.split("/"));
    const relative = path.relative(root, absolute);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      diagnostics.push({ code: "outside-authority", route });
      outsideAuthority = true;
      continue;
    }
    const state = regularFileWithoutSymlinks(root, route);
    if (state !== "regular-file") diagnostics.push({ code: state, route });
    bindings.push({ route, state });
  }
  return { complete: diagnostics.length === 0, outsideAuthority, diagnostics, bindings };
}

function regularFileWithoutSymlinks(root, route) {
  let current = root;
  const segments = route.split("/");
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return "owner-unreadable";
    }
    if (stat.isSymbolicLink()) return "owner-symlink";
    if (index < segments.length - 1 && !stat.isDirectory()) return "owner-not-regular";
    if (index === segments.length - 1 && !stat.isFile()) return "owner-not-regular";
  }
  return "regular-file";
}

function safeOwnerRoutes(candidate) {
  return (candidate?.scope?.ownerRoutes ?? []).filter(isProjectRoute).sort();
}

function isProjectRoute(route) {
  if (typeof route !== "string" || !route || route.startsWith("/") || route.includes("\\") || route.includes("\0")) return false;
  const normalized = path.posix.normalize(route);
  return normalized === route && normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
}

function parserReview(consequence, targetFiles) {
  return { consequence, targetFiles };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
