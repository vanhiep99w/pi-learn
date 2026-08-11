import { EVIDENCE_STATES } from "./evidence-states.js";
import { FINDING_SCHEMA_VERSION, FINDING_STATUSES, publicFindings } from "./schema.js";

const PROJECTION_KIND = "pi-harness.findings-projection";
const LEDGER_KIND = "pi-harness.findings";
const LEDGER_STATUSES = new Set(["empty", "complete", "recovered"]);
const ACTIVE_STATUSES = new Set(["open", "repairing", "partial", "blocked"]);
const STATUS_ORDER = new Map(FINDING_STATUSES.map((status, index) => [status, index]));
const MAX_RENDERED_FINDINGS = 64;
const MAX_RENDERED_TEXT = 600;
const MAX_RENDERED_ACCEPTANCE_CHECKS = 8;
const MAX_RENDERED_PROPOSALS = 16;
const MAX_DIAGNOSTICS = 32;
const SAFE_DIAGNOSTIC = /^[A-Za-z0-9._:-]{1,128}$/;

export function createFindingsProjection(ledger) {
  validateLedgerProjectionInput(ledger);
  const findings = publicFindings(ledger.findings);
  if (ledger.counts.total !== findings.length) {
    throw projectionError("FINDINGS_PROJECTION_INVALID", "Findings ledger count does not match its reader records");
  }

  const ordered = [...findings].sort((left, right) => {
    const leftActive = ACTIVE_STATUSES.has(left.status) ? 0 : 1;
    const rightActive = ACTIVE_STATUSES.has(right.status) ? 0 : 1;
    return leftActive - rightActive
      || (STATUS_ORDER.get(left.status) ?? Number.MAX_SAFE_INTEGER) - (STATUS_ORDER.get(right.status) ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id);
  });
  const displayed = ordered.slice(0, MAX_RENDERED_FINDINGS);
  const diagnostics = normalizeDiagnostics(ledger.diagnostics);
  const counts = projectionCounts(findings, displayed.length);

  const projection = {
    kind: PROJECTION_KIND,
    schemaVersion: FINDING_SCHEMA_VERSION,
    status: ledger.status,
    ledgerRevision: ledger.ledgerRevision,
    counts,
    diagnostics,
    boundary: {
      canonical: false,
      source: "private-findings-ledger",
      readerSafe: true,
      scores: false,
      inference: false,
    },
  };

  return {
    ...projection,
    markdown: renderFindingsMarkdown({ ...projection, findings: displayed }),
  };
}

export function renderFindingsMarkdown(projection) {
  const lines = [
    "## Findings",
    `- Ledger status: **${markdownText(projection.status)}** at revision **${projection.ledgerRevision}**`,
    `- Recorded findings: **${projection.counts.total}** — active **${projection.counts.active}**, completed **${projection.counts.completed}**`,
    "- Boundary: reader-safe projection of the private canonical Findings ledger; this Markdown is not the source of truth.",
    "- Interpretation: lifecycle and evidence states are displayed exactly as recorded; no score or outcome is inferred.",
  ];

  if (projection.diagnostics.length) {
    lines.push(`- Ledger diagnostics (reader-safe aliases): ${projection.diagnostics.map(markdownCode).join(", ")}`);
  }
  lines.push("");

  if (!projection.findings.length) {
    lines.push("No caller-supplied findings are recorded. Zero findings is valid and does not imply a passing score or successful outcome.");
    lines.push("");
    return lines.join("\n");
  }

  const active = projection.findings.filter((finding) => ACTIVE_STATUSES.has(finding.status));
  const completed = projection.findings.filter((finding) => !ACTIVE_STATUSES.has(finding.status));
  appendFindingGroup(lines, "Active findings", active);
  appendFindingGroup(lines, "Completed findings", completed);

  if (projection.counts.omitted > 0) {
    lines.push(`_Showing ${projection.counts.displayed}/${projection.counts.total} findings. ${projection.counts.omitted} additional record(s) were omitted by the bounded Markdown presentation; the canonical ledger is unchanged._`);
    lines.push("");
  }

  return lines.join("\n");
}

function appendFindingGroup(lines, title, findings) {
  if (!findings.length) return;
  lines.push(`### ${title}`);
  lines.push("");
  for (const finding of findings) {
    lines.push(`#### ${finding.id} — ${markdownText(finding.title)}`);
    lines.push(`- **Repair status:** ${markdownCode(finding.status)} · **Evidence:** ${markdownCode(finding.evidenceState)} · **Confidence:** ${markdownCode(finding.confidence)}`);
    lines.push(`- **Dimension/check:** ${markdownCode(finding.dimension)} / ${markdownCode(finding.check)}`);
    lines.push(`- **Impact:** ${markdownText(finding.impact)}`);
    lines.push(`- **Reason:** ${markdownText(finding.reason)}`);
    lines.push(`- **Expected outcome:** ${markdownText(finding.expectedOutcome)}`);
    lines.push(`- **Smallest owner:** ${markdownCode(finding.target.ownerRoute)} · package ${markdownCode(finding.target.packageRoute)}`);
    lines.push(`- **Acceptance checks:** ${boundedCodeList(finding.acceptanceChecks, MAX_RENDERED_ACCEPTANCE_CHECKS)}`);
    lines.push(`- **Linked proposals:** ${boundedCodeList(finding.proposalRefs, MAX_RENDERED_PROPOSALS)}`);
    lines.push(`- **Reader-safe evidence refs:** ${finding.evidenceRefs.length}`);
    lines.push("");
  }
}

function projectionCounts(findings, displayed) {
  const byStatus = Object.fromEntries(FINDING_STATUSES.map((status) => [status, 0]));
  const byEvidenceState = Object.fromEntries(EVIDENCE_STATES.map((state) => [state, 0]));
  let active = 0;
  for (const finding of findings) {
    byStatus[finding.status] += 1;
    byEvidenceState[finding.evidenceState] += 1;
    if (ACTIVE_STATUSES.has(finding.status)) active += 1;
  }
  return {
    total: findings.length,
    active,
    completed: findings.length - active,
    displayed,
    omitted: findings.length - displayed,
    byStatus,
    byEvidenceState,
  };
}

function boundedCodeList(values, limit) {
  if (!values.length) return "_none recorded_";
  const shown = values.slice(0, limit).map(markdownCode);
  if (values.length > limit) shown.push(`_${values.length - limit} more_`);
  return shown.join(", ");
}

function markdownText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const bounded = text.length > MAX_RENDERED_TEXT ? `${text.slice(0, MAX_RENDERED_TEXT - 1).trimEnd()}…` : text;
  return bounded.replace(/([\\`*_[\]<>#|])/g, "\\$1");
}

function markdownCode(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().replace(/`/g, "'");
  return `\`${text}\``;
}

function validateLedgerProjectionInput(ledger) {
  if (!isPlainObject(ledger)
    || ledger.kind !== LEDGER_KIND
    || ledger.schemaVersion !== FINDING_SCHEMA_VERSION
    || !LEDGER_STATUSES.has(ledger.status)
    || !Number.isSafeInteger(ledger.ledgerRevision)
    || ledger.ledgerRevision < 0
    || !isPlainObject(ledger.counts)
    || !Number.isSafeInteger(ledger.counts.total)
    || ledger.counts.total < 0
    || !Array.isArray(ledger.findings)
    || !Array.isArray(ledger.diagnostics)
    || !isPlainObject(ledger.authority)
    || ledger.authority.project !== true
    || ledger.authority.userHome !== false) {
    throw projectionError("FINDINGS_PROJECTION_INVALID", "Findings projection requires a valid reader ledger");
  }
}

function normalizeDiagnostics(diagnostics) {
  if (diagnostics.length > MAX_DIAGNOSTICS || diagnostics.some((item) => typeof item !== "string" || !SAFE_DIAGNOSTIC.test(item))) {
    throw projectionError("FINDINGS_PROJECTION_INVALID", "Findings projection diagnostics are invalid");
  }
  return [...diagnostics];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function projectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
