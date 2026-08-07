export const EvidenceState = Object.freeze({
  PRESENT: "Present",
  WIRED: "Wired",
  EXERCISED: "Exercised",
  OUTCOME_SUPPORTED: "Outcome-supported",
  MISSING: "Missing",
  UNOBSERVED: "Unobserved",
  NOT_APPLICABLE: "Not-applicable",
});

export const EVIDENCE_STATES = Object.freeze(Object.values(EvidenceState));

const EVIDENCE_STATE_SET = new Set(EVIDENCE_STATES);

export function isEvidenceState(value) {
  return typeof value === "string" && EVIDENCE_STATE_SET.has(value);
}

export function normalizeEvidenceState(value) {
  if (!isEvidenceState(value)) {
    const error = new Error(`Invalid evidence state: ${String(value)}`);
    error.code = "INVALID_EVIDENCE_STATE";
    throw error;
  }
  return value;
}
