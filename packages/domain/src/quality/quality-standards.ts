import { DomainError } from '../errors.js';

export const acceptanceRecordTypes = [
  'work_acceptance',
  'stage_acceptance',
  'completion_acceptance',
] as const;
export type AcceptanceRecordType = (typeof acceptanceRecordTypes)[number];

export const acceptanceResults = ['Accepted', 'Rejected', 'Conditional'] as const;
export type AcceptanceResult = (typeof acceptanceResults)[number];

export const acceptanceStatuses = [
  'Draft',
  'Contractor Signed',
  'Supervisor Signed',
  'Completed',
  'Rejected',
] as const;
export type AcceptanceStatus = (typeof acceptanceStatuses)[number];

export const findingSeverities = ['Low', 'Medium', 'High', 'Critical'] as const;
export type FindingSeverity = (typeof findingSeverities)[number];

export const findingStatuses = [
  'Open',
  'Pending Verification',
  'Resolved',
  'Closed',
  'Waived',
] as const;
export type FindingStatus = (typeof findingStatuses)[number];

export const inspectionStatuses = [
  'Draft',
  'In Progress',
  'Completed',
  'Accepted',
  'Rejected',
  'Cancelled',
] as const;
export type InspectionStatus = (typeof inspectionStatuses)[number];

export const checklistResultTypes = ['Pass', 'Fail', 'NA', 'Pending'] as const;
export type ChecklistResultType = (typeof checklistResultTypes)[number];

export const ND207_LEGAL_BASIS = 'Nghị định 207/2026/NĐ-CP & Thông tư 32/2026/TT-BXD';

/**
 * Validates 3-party acceptance workflow transitions according to NĐ 207/2026/NĐ-CP & TT 32/2026/TT-BXD.
 * Sequential ordering: Contractor -> TVGS (Supervisor) -> Ban QLDA (PMU).
 */
export function assertAcceptanceSignSequence(
  currentStatus: AcceptanceStatus,
  signingRole: 'contractor' | 'supervisor' | 'pmu',
): AcceptanceStatus {
  if (currentStatus === 'Completed' || currentStatus === 'Rejected') {
    throw new DomainError(
      'ACCEPTANCE_ALREADY_FINALIZED',
      `Acceptance record is already ${currentStatus} and cannot be signed.`,
    );
  }

  if (signingRole === 'contractor') {
    if (currentStatus !== 'Draft') {
      throw new DomainError(
        'ACCEPTANCE_SEQUENCE_VIOLATION',
        `Contractor can only sign when record is in Draft, current is ${currentStatus}.`,
      );
    }
    return 'Contractor Signed';
  }

  if (signingRole === 'supervisor') {
    if (currentStatus !== 'Contractor Signed') {
      throw new DomainError(
        'ACCEPTANCE_SEQUENCE_VIOLATION',
        'Contractor must sign before Supervisor can sign.',
      );
    }
    return 'Supervisor Signed';
  }

  if (signingRole === 'pmu') {
    if (currentStatus !== 'Supervisor Signed') {
      throw new DomainError(
        'ACCEPTANCE_SEQUENCE_VIOLATION',
        'Supervisor must sign before PMU can sign.',
      );
    }
    return 'Completed';
  }

  throw new DomainError('INVALID_SIGNING_ROLE', `Unknown signing role ${String(signingRole)}.`);
}

/**
 * Segregation of Duties (SoD) for Corrective Action Requests (CAR):
 * Performer cannot self-verify/close High or Critical findings.
 */
export function assertCarIndependence(
  performerId: string,
  verifierId: string,
  severity: FindingSeverity,
): void {
  if ((severity === 'High' || severity === 'Critical') && performerId === verifierId) {
    throw new DomainError(
      'CAR_INDEPENDENCE_VIOLATION',
      `Performer ${performerId} cannot self-verify and close a ${severity} severity finding under SoD rules.`,
    );
  }
}

/**
 * Validates inspection checklist results and evidence requirements.
 */
export function assertInspectionChecklistResult(input: {
  result: ChecklistResultType;
  requiresEvidence: boolean;
  evidenceFileIds: readonly string[];
  isMandatory: boolean;
}): void {
  if (input.isMandatory && input.result === 'Pending') {
    throw new DomainError(
      'MANDATORY_CHECKLIST_ITEM_PENDING',
      'Mandatory checklist item cannot be left Pending.',
    );
  }
  if (
    (input.requiresEvidence || input.result === 'Fail') &&
    input.evidenceFileIds.length === 0 &&
    input.result !== 'NA'
  ) {
    throw new DomainError(
      'EVIDENCE_REQUIRED',
      'Evidence photo or document is required for this checklist item.',
    );
  }
}
