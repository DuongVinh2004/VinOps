export declare const revisionStatuses: readonly ["Draft", "Under Review", "Approved", "Approved with Comments", "Rejected", "Published", "Superseded", "Withdrawn"];
export type RevisionStatus = (typeof revisionStatuses)[number];
export declare const revisionActions: readonly ["submit_review", "approve", "approve_with_comments", "reject", "publish", "withdraw"];
export type RevisionAction = (typeof revisionActions)[number];
export declare const fileStatuses: readonly ["Pending", "Uploading", "Validating", "Quarantined", "Available", "Rejected", "Purged"];
export type FileStatus = (typeof fileStatuses)[number];
export declare function revisionTransitionTarget(current: RevisionStatus, action: RevisionAction): RevisionStatus;
export declare function assertWithdrawAllowed(input: {
    status: RevisionStatus;
    isCurrent: boolean;
    reason: string | null | undefined;
}): void;
export type ReviewMode = 'sequential' | 'quorum';
export type ReviewDecision = 'approve' | 'approve_with_comments' | 'reject';
export type ReviewRoutePolicy = {
    mode: ReviewMode;
    requiredApprovals: number;
    rejectThreshold: number;
};
export type ReviewAssignmentSnapshot = {
    reviewerId: string;
    sequence: number;
    decision: ReviewDecision | null;
};
export type ReviewRouteResult = {
    completed: boolean;
    outcome: 'pending' | 'approved' | 'approved_with_comments' | 'rejected';
    actionableReviewerIds: readonly string[];
};
export declare function evaluateReviewRoute(policy: ReviewRoutePolicy, assignments: readonly ReviewAssignmentSnapshot[]): ReviewRouteResult;
export declare function assertReviewerMayDecide(input: {
    actorUserId: string;
    makerUserId: string;
    actionableReviewerIds: readonly string[];
    existingDecision: boolean;
}): void;
export declare function assertPublishAllowed(input: {
    status: RevisionStatus;
    fileStatus: FileStatus;
    routeCompleted: boolean;
    unresolvedMandatoryComments: number;
    makerUserId: string;
    publisherUserId: string;
}): void;
export declare function normalizeDocumentCode(value: string): string;
export declare function normalizeContextKey(value: string | null | undefined): string;
export declare function assertSafeFilename(value: string): string;
export type FilePolicy = {
    maximumBytes: number;
    allowedMediaTypes: readonly string[];
};
export declare function assertDeclaredFilePolicy(policy: FilePolicy, input: {
    sizeBytes: number;
    mediaType: string;
    filename: string;
    sha256: string;
}): void;
export declare function assertMagicBytes(mediaType: string, bytes: Uint8Array): void;
export declare function sha256Hex(bytes: Uint8Array): string;
export declare function assertUploadCompletion(input: {
    declaredSize: number;
    actualSize: number;
    declaredSha256: string;
    actualSha256: string;
    expiresAt: Date;
    now: Date;
    status: FileStatus;
}): void;
export declare function assertAnnotation(input: {
    page: number;
    x: number;
    y: number;
    kind: string;
    body?: string | null | undefined;
}): void;
export declare function signedUrlExpiry(now: Date, ttlSeconds: number): Date;
export declare function assertSingleCurrentRevision(input: {
    revisions: readonly {
        id: string;
        isCurrent?: boolean;
        status?: RevisionStatus;
    }[];
}): void;
export declare function generateTransmittalSignature(snapshotSha256: string, secret: string): string;
export declare function buildDrawingQrPayload(input: {
    transmittalId: string;
    documentCode: string;
    revisionCode: string;
    fileSha256: string;
    signature: string;
    issuedAt: string;
}): string;
export type DrawingQrVerificationResult = {
    valid: boolean;
    transmittalId?: string;
    documentCode?: string;
    revisionCode?: string;
    shaPrefix?: string;
    sigPrefix?: string;
    issuedAt?: string;
    error?: string;
};
export declare function parseDrawingQrPayload(token: string): DrawingQrVerificationResult;
export declare function buildTransmittalPackageManifest(input: {
    transmittalId: string;
    transmittalNumber: string;
    title: string;
    projectId: string;
    issuedAt: string;
    signature: string;
    items: readonly {
        documentId: string;
        documentCode: string;
        documentTitle: string;
        revisionId: string;
        revisionCode: string;
        fileSha256: string;
        filename: string;
    }[];
}): {
    schemaVersion: '1.0';
    iso19650Stage: 'PUBLISHED';
    packageId: string;
    packageNumber: string;
    projectId: string;
    issuedAt: string;
    signatureHmacSha256: string;
    totalDocuments: number;
    documents: readonly {
        documentId: string;
        code: string;
        title: string;
        revisionId: string;
        revisionCode: string;
        sha256: string;
        filename: string;
        qrPayload: string;
    }[];
};

