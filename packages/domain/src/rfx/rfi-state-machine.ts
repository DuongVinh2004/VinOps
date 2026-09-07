import { DomainError } from '../errors.js';

export const rfiStatuses = [
  'Draft',
  'Submitted',
  'Under Review',
  'Clarification Required',
  'Official Answered',
  'Closed',
] as const;
export type RfiStatus = (typeof rfiStatuses)[number];

export const rfiPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export type RfiPriority = (typeof rfiPriorities)[number];

export const rfiActions = [
  'submit',
  'start_review',
  'request_clarification',
  'provide_clarification',
  'answer_official',
  'close',
  'reopen',
] as const;
export type RfiAction = (typeof rfiActions)[number];

const rfiTransitions: Record<RfiStatus, Partial<Record<RfiAction, RfiStatus>>> = {
  Draft: {
    submit: 'Submitted',
  },
  Submitted: {
    start_review: 'Under Review',
    request_clarification: 'Clarification Required',
    answer_official: 'Official Answered',
  },
  'Under Review': {
    request_clarification: 'Clarification Required',
    answer_official: 'Official Answered',
  },
  'Clarification Required': {
    provide_clarification: 'Under Review',
  },
  'Official Answered': {
    close: 'Closed',
    reopen: 'Under Review',
  },
  Closed: {
    reopen: 'Under Review',
  },
};

export function rfiTransitionTarget(current: RfiStatus, action: RfiAction): RfiStatus {
  const target = rfiTransitions[current]?.[action];
  if (target === undefined) {
    throw new DomainError(
      'INVALID_RFI_TRANSITION',
      `RFI action ${action} is not permitted from ${current}.`,
    );
  }
  return target;
}

export function assertRfiMutable(status: RfiStatus): void {
  if (status === 'Closed' || status === 'Official Answered') {
    throw new DomainError('RFI_IMMUTABLE', `RFI cannot be modified while in status ${status}.`);
  }
}
