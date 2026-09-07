export declare const projectStatuses: readonly ["Setup", "Active", "Suspended", "Archiving", "Archived"];
export type ProjectStatus = (typeof projectStatuses)[number];
export declare const projectActions: readonly ["activate", "suspend", "resume", "start_archive", "complete_archive", "restore"];
export type ProjectAction = (typeof projectActions)[number];
export declare const membershipStatuses: readonly ["Active", "Suspended", "Ended"];
export type MembershipStatus = (typeof membershipStatuses)[number];
export declare const sensitiveRoles: readonly ["organization_owner", "project_admin", "security_admin", "break_glass_approver"];
export type SensitiveRole = (typeof sensitiveRoles)[number];
export declare function projectTransitionTarget(current: ProjectStatus, action: ProjectAction): ProjectStatus;
export type ProjectActivationPrerequisites = {
    timezone: string | null | undefined;
    numberingProfileId: string | null | undefined;
    hasOwnerMembership: boolean;
};
export declare function assertProjectActivationPrerequisites(prerequisites: ProjectActivationPrerequisites): void;
export declare function assertProjectMutable(status: ProjectStatus): void;
export declare function normalizeEmail(value: string): string;
export declare function isMembershipEffective(status: MembershipStatus, validFrom: Date | null, validTo: Date | null, now: Date): boolean;
export declare function assertMembershipEffective(status: MembershipStatus, validFrom: Date | null, validTo: Date | null, now: Date): void;
export declare function assertNoSensitiveSelfEscalation(actorUserId: string, targetUserId: string, requestedRoles: readonly string[]): void;
export type ResourceScope = {
    scopeType: 'project' | 'location' | 'work' | 'discipline' | 'classification';
    scopeId: string;
    actions: readonly string[];
};
export declare function assertResourceScope(scopes: readonly ResourceScope[], action: string, scopeType: ResourceScope['scopeType'], scopeId: string): void;
export type DelegationWindow = {
    validFrom: Date;
    validTo: Date;
    reason: string;
};
export declare function assertDelegationEffective(delegation: DelegationWindow, now: Date): void;
export type BreakGlassRequest = {
    reason: string;
    approvedAt: Date | null;
    validFrom: Date;
    validTo: Date;
    maxTtlMinutes: number;
};
export declare function assertBreakGlassEffective(request: BreakGlassRequest, now: Date): void;
export type TreeNode = {
    id: string;
    parentId: string | null;
    code: string;
    archivedAt: Date | null;
};
export declare function assertTreeNodeChange(nodes: readonly TreeNode[], candidate: Pick<TreeNode, 'id' | 'parentId' | 'code'>): void;
export declare function parseExpectedVersion(value: string | undefined): bigint;
export * from './document-control.js';
export { DomainError } from './errors.js';
//# sourceMappingURL=index.d.ts.map