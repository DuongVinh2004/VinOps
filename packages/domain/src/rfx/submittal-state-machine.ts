import { DomainError } from '../errors.js';

export const submittalStatuses = [
  'Draft',
  'Submitted',
  'Under Review',
  'Approved',
  'Approved with Comments',
  'Revise and Resubmit',
  'Rejected',
  'Closed',
] as const;
export type SubmittalStatus = (typeof submittalStatuses)[number];

export const submittalTypes = [
  'material_sample',
  'shop_drawing',
  'method_statement',
  'product_data',
  'other',
] as const;
export type SubmittalType = (typeof submittalTypes)[number];

export const submittalReviewStages = ['checker', 'consultant_lead', 'owner_final'] as const;
export type SubmittalReviewStage = (typeof submittalReviewStages)[number];

export const submittalReviewDecisions = [
  'Approved',
  'Approved with Comments',
  'Revise and Resubmit',
  'Rejected',
] as const;
export type SubmittalReviewDecision = (typeof submittalReviewDecisions)[number];

export const submittalActions = [
  'submit',
  'start_review',
  'approve',
  'approve_with_comments',
  'request_revision',
  'reject',
  'close',
  'resubmit',
] as const;
export type SubmittalAction = (typeof submittalActions)[number];

const submittalTransitions: Record<
  SubmittalStatus,
  Partial<Record<SubmittalAction, SubmittalStatus>>
> = {
  Draft: {
    submit: 'Submitted',
  },
  Submitted: {
    start_review: 'Under Review',
    approve: 'Approved',
    approve_with_comments: 'Approved with Comments',
    request_revision: 'Revise and Resubmit',
    reject: 'Rejected',
  },
  'Under Review': {
    approve: 'Approved',
    approve_with_comments: 'Approved with Comments',
    request_revision: 'Revise and Resubmit',
    reject: 'Rejected',
  },
  Approved: {
    close: 'Closed',
  },
  'Approved with Comments': {
    close: 'Closed',
  },
  'Revise and Resubmit': {
    resubmit: 'Submitted',
  },
  Rejected: {
    resubmit: 'Submitted',
    close: 'Closed',
  },
  Closed: {},
};

export function submittalTransitionTarget(
  current: SubmittalStatus,
  action: SubmittalAction,
): SubmittalStatus {
  const target = submittalTransitions[current]?.[action];
  if (target === undefined) {
    throw new DomainError(
      'INVALID_SUBMITTAL_TRANSITION',
      `Submittal action ${action} is not permitted from ${current}.`,
    );
  }
  return target;
}

export function reviewDecisionToSubmittalAction(
  decision: SubmittalReviewDecision,
): SubmittalAction {
  switch (decision) {
    case 'Approved':
      return 'approve';
    case 'Approved with Comments':
      return 'approve_with_comments';
    case 'Revise and Resubmit':
      return 'request_revision';
    case 'Rejected':
      return 'reject';
  }
}
