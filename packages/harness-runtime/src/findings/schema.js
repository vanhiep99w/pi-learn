import crypto from "node:crypto";
import { redactString } from "../safety/redaction.js";
import { normalizeEvidenceState } from "./evidence-states.js";

export const FINDING_SCHEMA_VERSION = 1;
export const FINDING_STATUSES = Object.freeze(["open", "repairing", "verified", "partial", "blocked", "closed"]);
export const FINDING_CONFIDENCES = Object.freeze(["low", "medium", "high"]);
export const FINDING_TARGET_KINDS = Object.freeze(["repo-root", "workspace-member", "standalone", "project"]);

const ID_PATTERN = /^F-(\d{4})$/;
const PROPOSAL_ID_PATTERN = /^P-\d{4}$/;
const ROUTE_PATTERN = /^[^\\\0]+$/;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/;
const MAX_FINDINGS = 256;
const MAX_EVIDENCE_REFS = 64;
const MAX_PROPOSAL_REFS = 64;
const MAX_ACCEPTANCE_CHECKS = 64;
const MAX_TEXT = 4000;
const MAX_ROUTE = 512;

const FINDING_KEYS = new Set([
  "schemaVersion",
  "id",
  "findingId",
  "revision",
  "title",
  "status",
  "dimension",
  "check",
  "evidenceState",
  "confidence",
  "impact",
  "reason",
  "target",
  "evidenceRefs",
  "expectedOutcome",
  "acceptanceChecks",
  "proposalRefs",
]);

export function validateFinding(value, { requireRevision = false } = {}) {
  return normalizeFinding(value, { requireRevision });
}

export function normalizeFinding(value, { requireRevision = false } = {}) {
  if (!isPlainObject(value)) fail("INVALID_FINDING", "Finding must be an object");
  for (const key of Object.keys(value)) {
    if (!FINDING_KEYS.has(key)) fail("INVALID_FINDING", `Unsupported finding field: ${key}`);
  }

  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== FINDING_SCHEMA_VERSION) fail("INVALID_FINDING_SCHEMA", "Finding schemaVersion must be 1");

  const id = value.id ?? value.findingId;
  if (value.id !== undefined && value.findingId !== undefined && value.id !== value.findingId) {
    fail("INVALID_FINDING_ID", "id and findingId must match");
  }
  validateFindingId(id);

  const revision = value.revision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
    fail("INVALID_FINDING_REVISION", "Finding revision must be a non-negative integer");
  }
  if (requireRevision && revision === undefined) fail("INVALID_FINDING_REVISION", "Stored finding revision is required");

  const normalized = {
    schemaVersion: FINDING_SCHEMA_VERSION,
    id,
    ...(revision === undefined ? {} : { revision }),
    title: boundedText(value.title, "title"),
    status: enumValue(value.status, FINDING_STATUSES, "status"),
    dimension: boundedText(value.dimension, "dimension"),
    check: boundedText(value.check, "check"),
    evidenceState: normalizeEvidenceState(value.evidenceState),
    confidence: enumValue(value.confidence, FINDING_CONFIDENCES, "confidence"),
    impact: boundedText(value.impact, "impact"),
    reason: boundedText(value.reason, "reason"),
    target: normalizeTarget(value.target),
    evidenceRefs: normalizeEvidenceRefs(value.evidenceRefs),
    expectedOutcome: boundedText(value.expectedOutcome, "expectedOutcome"),
    acceptanceChecks: normalizeTextArray(value.acceptanceChecks, "acceptanceChecks", MAX_ACCEPTANCE_CHECKS),
    proposalRefs: normalizeProposalRefs(value.proposalRefs),
  };
  return normalized;
}

export function validateFindingSet(value, options = {}) {
  if (!Array.isArray(value)) fail("INVALID_FINDING_SET", "Findings must be an array");
  if (value.length > MAX_FINDINGS) fail("FINDING_LIMIT_EXCEEDED", "Finding count exceeds the bounded limit");
  return dedupeFindings(value.map((item) => normalizeFinding(item, options)));
}

export function validateFindingId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id) || Number(id.slice(2)) < 1) {
    fail("INVALID_FINDING_ID", "Finding id must match F-####");
  }
  return id;
}

export function dedupeFindings(findings) {
  const byId = new Map();
  const byIdentity = new Map();
  for (const input of findings) {
    const finding = normalizeFinding(input);
    const identity = findingIdentity(finding);
    const existing = byId.get(finding.id);
    if (existing) {
      if (findingIdentity(existing) !== identity || !sameExceptProposalRefs(existing, finding)) {
        fail("DUPLICATE_FINDING_ID", `Conflicting records for ${finding.id}`);
      }
      existing.proposalRefs = [...new Set([...existing.proposalRefs, ...finding.proposalRefs])].sort();
      continue;
    }
    const identityOwner = byIdentity.get(identity);
    if (identityOwner && identityOwner !== finding.id) {
      fail("DUPLICATE_FINDING_IDENTITY", `Finding identity is already owned by ${identityOwner}`);
    }
    byId.set(finding.id, finding);
    byIdentity.set(identity, finding.id);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function findingIdentity(value) {
  const finding = normalizeFinding(value);
  return crypto.createHash("sha256").update(stableStringify({
    title: finding.title,
    dimension: finding.dimension,
    check: finding.check,
    target: finding.target,
    expectedOutcome: finding.expectedOutcome,
  })).digest("hex");
}

export const findingFingerprint = findingIdentity;

export function publicFinding(value) {
  const finding = normalizeFinding(value, { requireRevision: value?.revision !== undefined });
  return {
    schemaVersion: FINDING_SCHEMA_VERSION,
    id: finding.id,
    ...(finding.revision === undefined ? {} : { revision: finding.revision }),
    title: publicText(finding.title),
    status: finding.status,
    dimension: publicText(finding.dimension),
    check: publicText(finding.check),
    evidenceState: finding.evidenceState,
    confidence: finding.confidence,
    impact: publicText(finding.impact),
    reason: publicText(finding.reason),
    target: publicTarget(finding.target),
    evidenceRefs: finding.evidenceRefs.map(publicEvidenceRef).filter(Boolean),
    expectedOutcome: publicText(finding.expectedOutcome),
    acceptanceChecks: finding.acceptanceChecks.map(publicText),
    proposalRefs: [...finding.proposalRefs],
  };
}

export function publicFindings(findings) {
  return validateFindingSet(findings, { requireRevision: false }).map(publicFinding);
}

export function findingWithoutRevision(value) {
  const normalized = normalizeFinding(value);
  const { revision: _revision, ...withoutRevision } = normalized;
  return withoutRevision;
}

function normalizeTarget(value) {
  if (!isPlainObject(value)) fail("INVALID_FINDING_TARGET", "Finding target must be an object");
  const allowed = new Set(["kind", "route", "packageRoute", "ownerRoute"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("INVALID_FINDING_TARGET", `Unsupported target field: ${key}`);
  const kind = enumValue(value.kind, FINDING_TARGET_KINDS, "target.kind");
  const route = value.route === undefined ? undefined : safeRoute(value.route, "target.route");
  if (value.packageRoute === undefined || value.ownerRoute === undefined) {
    fail("INVALID_FINDING_TARGET", "Finding target packageRoute and ownerRoute are required");
  }
  const packageRoute = safeRoute(value.packageRoute, "target.packageRoute");
  const ownerRoute = safeRoute(value.ownerRoute, "target.ownerRoute");
  return {
    kind,
    ...(route === undefined ? {} : { route }),
    packageRoute,
    ownerRoute,
  };
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) fail("INVALID_FINDING_EVIDENCE_REFS", "evidenceRefs must be an array");
  if (value.length > MAX_EVIDENCE_REFS) fail("FINDING_LIMIT_EXCEEDED", "Evidence reference count exceeds the bounded limit");
  return value.map((ref, index) => {
    if (!isPlainObject(ref)) fail("INVALID_FINDING_EVIDENCE_REF", `Evidence reference ${index} must be an object`);
    const result = {};
    for (const [key, item] of Object.entries(ref)) {
      if (key.length > 64 || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) fail("INVALID_FINDING_EVIDENCE_REF", "Evidence reference key is invalid");
      if (typeof item === "string") {
        if (item.length > 512 || item.includes("\0")) fail("INVALID_FINDING_EVIDENCE_REF", "Evidence reference text is invalid");
        result[key] = item;
      } else if (Number.isSafeInteger(item) || typeof item === "boolean" || item === null) {
        result[key] = item;
      } else {
        fail("INVALID_FINDING_EVIDENCE_REF", "Evidence references must contain bounded scalar values");
      }
    }
    return result;
  });
}

function normalizeProposalRefs(value) {
  if (!Array.isArray(value)) fail("INVALID_FINDING_PROPOSAL_REFS", "proposalRefs must be an array");
  if (value.length > MAX_PROPOSAL_REFS) fail("FINDING_LIMIT_EXCEEDED", "Proposal reference count exceeds the bounded limit");
  const refs = value.map((item) => {
    if (typeof item !== "string" || !PROPOSAL_ID_PATTERN.test(item)) fail("INVALID_FINDING_PROPOSAL_REF", "proposalRefs must contain P-#### ids");
    return item;
  });
  return [...new Set(refs)].sort();
}

function normalizeTextArray(value, field, maxItems) {
  if (!Array.isArray(value)) fail("INVALID_FINDING_FIELD", `${field} must be an array`);
  if (value.length > maxItems) fail("FINDING_LIMIT_EXCEEDED", `${field} exceeds the bounded limit`);
  return value.map((item) => boundedText(item, `${field} item`));
}

function boundedText(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT || value.includes("\0")) {
    fail("INVALID_FINDING_FIELD", `${field} must be non-empty bounded text`);
  }
  return value;
}

function safeRoute(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ROUTE || !ROUTE_PATTERN.test(value)) {
    fail("INVALID_FINDING_TARGET", `${field} must be a project-relative route`);
  }
  if (value.startsWith("/") || value.startsWith("~") || value.includes("://") || value.split("/").includes("..")) {
    fail("INVALID_FINDING_TARGET", `${field} must be a project-relative route`);
  }
  return value;
}

function enumValue(value, values, field) {
  if (typeof value !== "string" || !values.includes(value)) fail("INVALID_FINDING_FIELD", `Invalid ${field}`);
  return value;
}

function sameExceptProposalRefs(left, right) {
  const leftWithoutRevision = findingWithoutRevision(left);
  const rightWithoutRevision = findingWithoutRevision(right);
  return stableStringify({ ...leftWithoutRevision, proposalRefs: [] }) === stableStringify({ ...rightWithoutRevision, proposalRefs: [] });
}

function publicEvidenceRef(ref) {
  const result = {};
  if (safePublicToken(ref.kind)) result.kind = ref.kind;
  if (safeRouteForProjection(ref.route)) result.route = ref.route;
  if (safeToken(ref.sectionId)) result.sectionId = ref.sectionId;
  if (safePublicToken(ref.eventClass)) result.eventClass = ref.eventClass;
  if (Number.isSafeInteger(ref.ordinal) && ref.ordinal >= 0) result.ordinal = ref.ordinal;
  if (safePublicToken(ref.state)) result.state = ref.state;
  if (safePublicToken(ref.source)) result.source = ref.source;
  return Object.keys(result).length ? result : undefined;
}

function publicTarget(target) {
  const result = { kind: target.kind, packageRoute: target.packageRoute, ownerRoute: target.ownerRoute };
  if (target.route !== undefined) result.route = target.route;
  return result;
}

function publicText(value) {
  return redactString(value).value
    .replace(/~\/\.pi(?:\/[A-Za-z0-9._-]+)*/g, "<private-path>")
    .replace(/(?:^|[\s([{"'`=])\/(?:[^\s)\]}>,;'"`]+)/g, (match) => `${match.slice(0, 1)}<absolute-path>`)
    .replace(/\b(?:rawRef|privateRef|sessionFile|payload|prompt|command)\s*[:=]\s*[^\s,;]+/gi, "<private-locator>")
    .replace(/\s+/g, " ")
    .trim();
}

function safeRouteForProjection(value) {
  return typeof value === "string" && value.length <= MAX_ROUTE && !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") && !value.startsWith("~") && !value.includes("://") && !value.split("/").includes("..")
    ? value
    : undefined;
}

function safeToken(value) {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value);
}

function safePublicToken(value) {
  return safeToken(value) && !/session|raw|private|prompt|command|payload|secret/i.test(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
