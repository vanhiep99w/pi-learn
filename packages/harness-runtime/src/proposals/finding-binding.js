import { readFindingsLedger } from "../findings/ledger.js";
import { validateFindingId } from "../findings/schema.js";

export const PROPOSAL_FINDING_INVALID = "PROPOSAL_FINDING_INVALID";
export const PROPOSAL_FINDING_MISSING = "PROPOSAL_FINDING_MISSING";
export const PROPOSAL_FINDING_REVISION_STALE = "PROPOSAL_FINDING_REVISION_STALE";

export function normalizeProposalFindingBinding(proposal = {}) {
  const hasFindingId = proposal.findingId !== undefined;
  const hasExpectedRevision = proposal.expectedFindingRevision !== undefined;
  if (!hasFindingId && !hasExpectedRevision) return {};
  if (!hasFindingId || !hasExpectedRevision) {
    throw bindingError(PROPOSAL_FINDING_INVALID, "Bound proposals require findingId and expectedFindingRevision");
  }

  try {
    validateFindingId(proposal.findingId);
  } catch (error) {
    throw bindingError(PROPOSAL_FINDING_INVALID, "Proposal findingId must match F-####", error);
  }
  if (!Number.isSafeInteger(proposal.expectedFindingRevision) || proposal.expectedFindingRevision < 0) {
    throw bindingError(PROPOSAL_FINDING_INVALID, "expectedFindingRevision must be a non-negative safe integer");
  }
  return {
    findingId: proposal.findingId,
    expectedFindingRevision: proposal.expectedFindingRevision,
  };
}

export function validateProposalFindingBinding({ config, project, proposal } = {}) {
  const binding = normalizeProposalFindingBinding(proposal);
  if (!binding.findingId) return { bound: false };

  const ledger = readFindingsLedger({ config, project });
  const finding = ledger.findings.find((candidate) => candidate.id === binding.findingId);
  if (!finding) {
    throw bindingError(PROPOSAL_FINDING_MISSING, `Finding ${binding.findingId} does not exist`);
  }
  if (finding.revision !== binding.expectedFindingRevision) {
    throw bindingError(
      PROPOSAL_FINDING_REVISION_STALE,
      `Finding ${binding.findingId} revision ${finding.revision} does not match expected ${binding.expectedFindingRevision}`,
    );
  }
  return { bound: true, ...binding };
}

function bindingError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.exitCode = 2;
  return error;
}
