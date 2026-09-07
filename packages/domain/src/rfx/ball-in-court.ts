import type { RfiStatus } from './rfi-state-machine.js';
import type { SubmittalStatus } from './submittal-state-machine.js';

export type RfiParties = {
  requestingPartnerOrganizationId: string;
  respondingPartnerOrganizationId?: string | null;
};

export type SubmittalParties = {
  makerPartnerOrganizationId: string;
  leadContractorPartnerOrganizationId?: string | null;
  consultantPartnerOrganizationId?: string | null;
};

/**
 * Computes which partner organization currently holds the Ball-in-Court for an RFI.
 */
export function computeRfiBallInCourt(status: RfiStatus, parties: RfiParties): string | null {
  switch (status) {
    case 'Draft':
      return parties.requestingPartnerOrganizationId;
    case 'Submitted':
    case 'Under Review':
      return parties.respondingPartnerOrganizationId ?? null;
    case 'Clarification Required':
      return parties.requestingPartnerOrganizationId;
    case 'Official Answered':
      return parties.requestingPartnerOrganizationId;
    case 'Closed':
      return null;
  }
}

/**
 * Computes which partner organization currently holds the Ball-in-Court for a Submittal.
 */
export function computeSubmittalBallInCourt(
  status: SubmittalStatus,
  parties: SubmittalParties,
): string | null {
  switch (status) {
    case 'Draft':
      return parties.makerPartnerOrganizationId;
    case 'Submitted':
      return (
        parties.leadContractorPartnerOrganizationId ??
        parties.consultantPartnerOrganizationId ??
        null
      );
    case 'Under Review':
      return parties.consultantPartnerOrganizationId ?? null;
    case 'Revise and Resubmit':
    case 'Rejected':
      return parties.makerPartnerOrganizationId;
    case 'Approved':
    case 'Approved with Comments':
      return parties.leadContractorPartnerOrganizationId ?? null;
    case 'Closed':
      return null;
  }
}
