import { DomainError } from './errors.js';
export const projectStatuses = ['Setup', 'Active', 'Suspended', 'Archiving', 'Archived'];
export const projectActions = [
    'activate',
    'suspend',
    'resume',
    'start_archive',
    'complete_archive',
    'restore',
];
export const membershipStatuses = ['Active', 'Suspended', 'Ended'];
export const sensitiveRoles = [
    'organization_owner',
    'project_admin',
    'security_admin',
    'break_glass_approver',
];
const transitionTargets = {
    Setup: { activate: 'Active' },
    Active: { suspend: 'Suspended', start_archive: 'Archiving' },
    Suspended: { resume: 'Active', start_archive: 'Archiving' },
    Archiving: { complete_archive: 'Archived' },
    Archived: { restore: 'Suspended' },
};
export function projectTransitionTarget(current, action) {
    const target = transitionTargets[current][action];
    if (target === undefined) {
        throw new DomainError('INVALID_PROJECT_TRANSITION', `Project action ${action} is not permitted from ${current}.`);
    }
    return target;
}
export function assertProjectActivationPrerequisites(prerequisites) {
    if (prerequisites.timezone === undefined ||
        prerequisites.timezone === null ||
        prerequisites.timezone.trim().length === 0 ||
        prerequisites.numberingProfileId === undefined ||
        prerequisites.numberingProfileId === null ||
        prerequisites.numberingProfileId.trim().length === 0 ||
        !prerequisites.hasOwnerMembership) {
        throw new DomainError('PROJECT_ACTIVATION_PREREQUISITES_MISSING', 'Project requires timezone, numbering profile, and active owner membership before activation.');
    }
}
export function assertProjectMutable(status) {
    if (status !== 'Setup' && status !== 'Active') {
        throw new DomainError('PROJECT_NOT_MUTABLE', 'Project context cannot be changed while the project is suspended or archived.');
    }
}
export function normalizeEmail(value) {
    const normalized = value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
        throw new DomainError('INVALID_EMAIL', 'Email address is not valid.');
    }
    return normalized;
}
export function isMembershipEffective(status, validFrom, validTo, now) {
    return (status === 'Active' &&
        (validFrom === null || validFrom.getTime() <= now.getTime()) &&
        (validTo === null || validTo.getTime() > now.getTime()));
}
export function assertMembershipEffective(status, validFrom, validTo, now) {
    if (!isMembershipEffective(status, validFrom, validTo, now)) {
        throw new DomainError('MEMBERSHIP_NOT_EFFECTIVE', 'The membership is not currently effective.');
    }
}
export function assertNoSensitiveSelfEscalation(actorUserId, targetUserId, requestedRoles) {
    if (actorUserId === targetUserId &&
        requestedRoles.some((role) => sensitiveRoles.includes(role))) {
        throw new DomainError('SELF_ESCALATION_FORBIDDEN', 'A user cannot grant a sensitive role to themselves.');
    }
}
export function assertResourceScope(scopes, action, scopeType, scopeId) {
    const allowed = scopes.some((scope) => scope.actions.includes(action) &&
        (scope.scopeType === 'project' ||
            (scope.scopeType === scopeType && scope.scopeId === scopeId)));
    if (!allowed) {
        throw new DomainError('RESOURCE_SCOPE_DENIED', 'The membership does not include this resource scope.');
    }
}
export function assertDelegationEffective(delegation, now) {
    if (delegation.reason.trim().length === 0 ||
        delegation.validFrom.getTime() > now.getTime() ||
        delegation.validTo.getTime() <= now.getTime()) {
        throw new DomainError('DELEGATION_NOT_EFFECTIVE', 'Delegation is not currently effective.');
    }
}
export function assertBreakGlassEffective(request, now) {
    const ttl = request.validTo.getTime() - request.validFrom.getTime();
    if (request.reason.trim().length === 0 ||
        request.approvedAt === null ||
        ttl <= 0 ||
        ttl > request.maxTtlMinutes * 60_000 ||
        request.validFrom.getTime() > now.getTime() ||
        request.validTo.getTime() <= now.getTime()) {
        throw new DomainError('BREAK_GLASS_NOT_EFFECTIVE', 'Break-glass access is not currently effective.');
    }
}
export function assertTreeNodeChange(nodes, candidate) {
    if (candidate.parentId === candidate.id) {
        throw new DomainError('TREE_CYCLE', 'A node cannot be its own parent.');
    }
    const activeSibling = nodes.find((node) => node.id !== candidate.id &&
        node.archivedAt === null &&
        node.parentId === candidate.parentId &&
        node.code === candidate.code);
    if (activeSibling !== undefined) {
        throw new DomainError('DUPLICATE_SIBLING_CODE', 'An active sibling already uses this code.');
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let cursor = candidate.parentId;
    const visited = new Set();
    while (cursor !== null) {
        if (cursor === candidate.id || visited.has(cursor)) {
            throw new DomainError('TREE_CYCLE', 'The requested parent would create a cycle.');
        }
        visited.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
    }
}
export function parseExpectedVersion(value) {
    if (value === undefined || !/^\d+$/u.test(value) || value === '0') {
        throw new DomainError('EXPECTED_VERSION_REQUIRED', 'A positive expected version is required.');
    }
    return BigInt(value);
}
export * from './document-control.js';
export { DomainError } from './errors.js';
//# sourceMappingURL=index.js.map