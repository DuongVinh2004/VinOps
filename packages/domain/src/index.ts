import { DomainError } from './errors.js';

export const projectStatuses = ['Setup', 'Active', 'Suspended', 'Archiving', 'Archived'] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const projectActions = [
  'activate',
  'suspend',
  'resume',
  'start_archive',
  'complete_archive',
  'restore',
] as const;
export type ProjectAction = (typeof projectActions)[number];

export const membershipStatuses = ['Active', 'Suspended', 'Ended'] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

export const sensitiveRoles = [
  'organization_owner',
  'project_admin',
  'security_admin',
  'break_glass_approver',
] as const;
export type SensitiveRole = (typeof sensitiveRoles)[number];

const transitionTargets: Record<ProjectStatus, Partial<Record<ProjectAction, ProjectStatus>>> = {
  Setup: { activate: 'Active' },
  Active: { suspend: 'Suspended', start_archive: 'Archiving' },
  Suspended: { resume: 'Active', start_archive: 'Archiving' },
  Archiving: { complete_archive: 'Archived' },
  Archived: { restore: 'Suspended' },
};

export function projectTransitionTarget(
  current: ProjectStatus,
  action: ProjectAction,
): ProjectStatus {
  const target = transitionTargets[current][action];
  if (target === undefined) {
    throw new DomainError(
      'INVALID_PROJECT_TRANSITION',
      `Project action ${action} is not permitted from ${current}.`,
    );
  }
  return target;
}

export type ProjectActivationPrerequisites = {
  timezone: string | null | undefined;
  numberingProfileId: string | null | undefined;
  hasOwnerMembership: boolean;
};

export function assertProjectActivationPrerequisites(
  prerequisites: ProjectActivationPrerequisites,
): void {
  if (
    prerequisites.timezone === undefined ||
    prerequisites.timezone === null ||
    prerequisites.timezone.trim().length === 0 ||
    prerequisites.numberingProfileId === undefined ||
    prerequisites.numberingProfileId === null ||
    prerequisites.numberingProfileId.trim().length === 0 ||
    !prerequisites.hasOwnerMembership
  ) {
    throw new DomainError(
      'PROJECT_ACTIVATION_PREREQUISITES_MISSING',
      'Project requires timezone, numbering profile, and active owner membership before activation.',
    );
  }
}

export function assertProjectMutable(status: ProjectStatus): void {
  if (status !== 'Setup' && status !== 'Active') {
    throw new DomainError(
      'PROJECT_NOT_MUTABLE',
      'Project context cannot be changed while the project is suspended or archived.',
    );
  }
}

export function normalizeEmail(value: string): string {
  const normalized = value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new DomainError('INVALID_EMAIL', 'Email address is not valid.');
  }
  return normalized;
}

export function isMembershipEffective(
  status: MembershipStatus,
  validFrom: Date | null,
  validTo: Date | null,
  now: Date,
): boolean {
  return (
    status === 'Active' &&
    (validFrom === null || validFrom.getTime() <= now.getTime()) &&
    (validTo === null || validTo.getTime() > now.getTime())
  );
}

export function assertMembershipEffective(
  status: MembershipStatus,
  validFrom: Date | null,
  validTo: Date | null,
  now: Date,
): void {
  if (!isMembershipEffective(status, validFrom, validTo, now)) {
    throw new DomainError('MEMBERSHIP_NOT_EFFECTIVE', 'The membership is not currently effective.');
  }
}

export function assertNoSensitiveSelfEscalation(
  actorUserId: string,
  targetUserId: string,
  requestedRoles: readonly string[],
): void {
  if (
    actorUserId === targetUserId &&
    requestedRoles.some((role) => sensitiveRoles.includes(role as SensitiveRole))
  ) {
    throw new DomainError(
      'SELF_ESCALATION_FORBIDDEN',
      'A user cannot grant a sensitive role to themselves.',
    );
  }
}

export type ResourceScope = {
  scopeType: 'project' | 'location' | 'work' | 'discipline' | 'classification';
  scopeId: string;
  actions: readonly string[];
};

export function assertResourceScope(
  scopes: readonly ResourceScope[],
  action: string,
  scopeType: ResourceScope['scopeType'],
  scopeId: string,
): void {
  const allowed = scopes.some(
    (scope) =>
      scope.actions.includes(action) &&
      (scope.scopeType === 'project' ||
        (scope.scopeType === scopeType && scope.scopeId === scopeId)),
  );
  if (!allowed) {
    throw new DomainError(
      'RESOURCE_SCOPE_DENIED',
      'The membership does not include this resource scope.',
    );
  }
}

export type DelegationWindow = {
  validFrom: Date;
  validTo: Date;
  reason: string;
};

export function assertDelegationEffective(delegation: DelegationWindow, now: Date): void {
  if (
    delegation.reason.trim().length === 0 ||
    delegation.validFrom.getTime() > now.getTime() ||
    delegation.validTo.getTime() <= now.getTime()
  ) {
    throw new DomainError('DELEGATION_NOT_EFFECTIVE', 'Delegation is not currently effective.');
  }
}

export type BreakGlassRequest = {
  reason: string;
  approvedAt: Date | null;
  validFrom: Date;
  validTo: Date;
  maxTtlMinutes: number;
};

export function assertBreakGlassEffective(request: BreakGlassRequest, now: Date): void {
  const ttl = request.validTo.getTime() - request.validFrom.getTime();
  if (
    request.reason.trim().length === 0 ||
    request.approvedAt === null ||
    ttl <= 0 ||
    ttl > request.maxTtlMinutes * 60_000 ||
    request.validFrom.getTime() > now.getTime() ||
    request.validTo.getTime() <= now.getTime()
  ) {
    throw new DomainError(
      'BREAK_GLASS_NOT_EFFECTIVE',
      'Break-glass access is not currently effective.',
    );
  }
}

export type TreeNode = {
  id: string;
  parentId: string | null;
  code: string;
  archivedAt: Date | null;
};

export function assertTreeNodeChange(
  nodes: readonly TreeNode[],
  candidate: Pick<TreeNode, 'id' | 'parentId' | 'code'>,
): void {
  if (candidate.parentId === candidate.id) {
    throw new DomainError('TREE_CYCLE', 'A node cannot be its own parent.');
  }

  const activeSibling = nodes.find(
    (node) =>
      node.id !== candidate.id &&
      node.archivedAt === null &&
      node.parentId === candidate.parentId &&
      node.code === candidate.code,
  );
  if (activeSibling !== undefined) {
    throw new DomainError('DUPLICATE_SIBLING_CODE', 'An active sibling already uses this code.');
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  let cursor = candidate.parentId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (cursor === candidate.id || visited.has(cursor)) {
      throw new DomainError('TREE_CYCLE', 'The requested parent would create a cycle.');
    }
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
}

export function parseExpectedVersion(value: string | undefined): bigint {
  if (value === undefined || !/^\d+$/u.test(value) || value === '0') {
    throw new DomainError('EXPECTED_VERSION_REQUIRED', 'A positive expected version is required.');
  }
  return BigInt(value);
}

export * from './document-control.js';
export * from './field-issues/index.js';
export * from './rfx/index.js';
export { DomainError } from './errors.js';
