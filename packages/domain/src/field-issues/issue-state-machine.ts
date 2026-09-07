import { DomainError } from '../errors.js';

export const issueStatuses = [
  'Open',
  'Under Triage',
  'Assigned',
  'In Progress',
  'Resolved',
  'Closed',
] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export const issueSeverities = ['low', 'medium', 'high', 'critical'] as const;
export type IssueSeverity = (typeof issueSeverities)[number];

export const issueActions = [
  'triage',
  'assign',
  'start_progress',
  'resolve',
  'close',
  'reopen',
] as const;
export type IssueAction = (typeof issueActions)[number];

const issueTransitions: Record<IssueStatus, Partial<Record<IssueAction, IssueStatus>>> = {
  Open: {
    triage: 'Under Triage',
    assign: 'Assigned',
  },
  'Under Triage': {
    assign: 'Assigned',
  },
  Assigned: {
    start_progress: 'In Progress',
    assign: 'Assigned',
  },
  'In Progress': {
    resolve: 'Resolved',
    assign: 'Assigned',
  },
  Resolved: {
    close: 'Closed',
    reopen: 'Open',
  },
  Closed: {
    reopen: 'Open',
  },
};

export function issueTransitionTarget(current: IssueStatus, action: IssueAction): IssueStatus {
  const target = issueTransitions[current]?.[action];
  if (target === undefined) {
    throw new DomainError(
      'INVALID_ISSUE_TRANSITION',
      `Issue action ${action} is not permitted from ${current}.`,
    );
  }
  return target;
}

export function assertIssueMutable(status: IssueStatus): void {
  if (status === 'Closed') {
    throw new DomainError('ISSUE_CLOSED', 'Closed issues cannot be modified without reopening.');
  }
}

export function assertValidSeverity(severity: string): asserts severity is IssueSeverity {
  if (!issueSeverities.includes(severity as IssueSeverity)) {
    throw new DomainError(
      'INVALID_ISSUE_SEVERITY',
      `Severity ${severity} is not valid. Must be one of: ${issueSeverities.join(', ')}.`,
    );
  }
}
