import { createHash } from 'node:crypto';
import { DomainError } from './errors.js';
export const revisionStatuses = [
    'Draft',
    'Under Review',
    'Approved',
    'Approved with Comments',
    'Rejected',
    'Published',
    'Superseded',
    'Withdrawn',
];
export const revisionActions = [
    'submit_review',
    'approve',
    'approve_with_comments',
    'reject',
    'publish',
    'withdraw',
];
export const fileStatuses = [
    'Pending',
    'Uploading',
    'Validating',
    'Quarantined',
    'Available',
    'Rejected',
    'Purged',
];
const revisionTransitions = {
    Draft: { submit_review: 'Under Review', withdraw: 'Withdrawn' },
    'Under Review': {
        approve: 'Approved',
        approve_with_comments: 'Approved with Comments',
        reject: 'Rejected',
        withdraw: 'Withdrawn',
    },
    Approved: { publish: 'Published' },
    'Approved with Comments': { publish: 'Published' },
    Rejected: {},
    Published: {},
    Superseded: {},
    Withdrawn: {},
};
export function revisionTransitionTarget(current, action) {
    const target = revisionTransitions[current][action];
    if (target === undefined) {
        throw new DomainError('INVALID_REVISION_TRANSITION', `Revision action ${action} is not permitted from ${current}.`);
    }
    return target;
}
export function assertWithdrawAllowed(input) {
    revisionTransitionTarget(input.status, 'withdraw');
    if (input.isCurrent) {
        throw new DomainError('CURRENT_REVISION_WITHDRAW_FORBIDDEN', 'A current revision cannot be withdrawn.');
    }
    if ((input.reason?.trim().length ?? 0) === 0) {
        throw new DomainError('WITHDRAW_REASON_REQUIRED', 'A withdrawal reason is required.');
    }
}
export function evaluateReviewRoute(policy, assignments) {
    if (assignments.length === 0) {
        throw new DomainError('REVIEW_ROUTE_REQUIRED', 'At least one reviewer is required.');
    }
    if (!Number.isInteger(policy.requiredApprovals) ||
        policy.requiredApprovals < 1 ||
        policy.requiredApprovals > assignments.length ||
        !Number.isInteger(policy.rejectThreshold) ||
        policy.rejectThreshold < 1 ||
        policy.rejectThreshold > assignments.length) {
        throw new DomainError('REVIEW_POLICY_INVALID', 'Review quorum and reject threshold are invalid.');
    }
    const uniqueReviewers = new Set(assignments.map((assignment) => assignment.reviewerId));
    if (uniqueReviewers.size !== assignments.length) {
        throw new DomainError('DUPLICATE_REVIEWER', 'A reviewer may appear only once in a route.');
    }
    if (assignments.some((assignment) => !Number.isInteger(assignment.sequence) || assignment.sequence < 1)) {
        throw new DomainError('REVIEW_SEQUENCE_INVALID', 'Reviewer sequence must be a positive integer.');
    }
    const decisions = assignments.filter((assignment) => assignment.decision !== null);
    const rejects = decisions.filter((assignment) => assignment.decision === 'reject').length;
    if (rejects >= policy.rejectThreshold) {
        return { completed: true, outcome: 'rejected', actionableReviewerIds: [] };
    }
    const approvals = decisions.filter((assignment) => assignment.decision !== 'reject');
    if (approvals.length >= policy.requiredApprovals) {
        return {
            completed: true,
            outcome: approvals.some((assignment) => assignment.decision === 'approve_with_comments')
                ? 'approved_with_comments'
                : 'approved',
            actionableReviewerIds: [],
        };
    }
    const pending = assignments.filter((assignment) => assignment.decision === null);
    if (policy.mode === 'quorum') {
        return {
            completed: false,
            outcome: 'pending',
            actionableReviewerIds: pending.map((assignment) => assignment.reviewerId),
        };
    }
    const nextSequence = Math.min(...pending.map((assignment) => assignment.sequence));
    return {
        completed: false,
        outcome: 'pending',
        actionableReviewerIds: pending
            .filter((assignment) => assignment.sequence === nextSequence)
            .map((assignment) => assignment.reviewerId),
    };
}
export function assertReviewerMayDecide(input) {
    if (input.actorUserId === input.makerUserId) {
        throw new DomainError('MAKER_CHECKER_VIOLATION', 'The revision maker cannot decide its review.');
    }
    if (!input.actionableReviewerIds.includes(input.actorUserId)) {
        throw new DomainError('REVIEWER_NOT_ACTIONABLE', 'The reviewer is not currently actionable.');
    }
    if (input.existingDecision) {
        throw new DomainError('REVIEW_DECISION_IMMUTABLE', 'A review decision cannot be edited in place.');
    }
}
export function assertPublishAllowed(input) {
    revisionTransitionTarget(input.status, 'publish');
    if (input.fileStatus !== 'Available') {
        throw new DomainError('FILE_NOT_AVAILABLE', 'The revision file is not available.');
    }
    if (!input.routeCompleted) {
        throw new DomainError('REVIEW_ROUTE_INCOMPLETE', 'The review route is incomplete.');
    }
    if (input.status === 'Approved with Comments' && input.unresolvedMandatoryComments > 0) {
        throw new DomainError('MANDATORY_COMMENT_DISPOSITION_REQUIRED', 'All mandatory review comments require a disposition before publication.');
    }
    if (input.makerUserId === input.publisherUserId) {
        throw new DomainError('MAKER_CHECKER_VIOLATION', 'The revision maker cannot publish it.');
    }
}
export function normalizeDocumentCode(value) {
    const code = value.trim().normalize('NFKC').toLocaleUpperCase('en-US');
    if (code.length < 1 || code.length > 120 || !/^[A-Z0-9][A-Z0-9._/-]*$/u.test(code)) {
        throw new DomainError('DOCUMENT_CODE_INVALID', 'Document code does not satisfy the project policy.');
    }
    return code;
}
export function normalizeContextKey(value) {
    const context = value?.trim().normalize('NFKC') ?? 'default';
    if (context.length < 1 ||
        context.length > 120 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(context)) {
        throw new DomainError('DISTRIBUTION_CONTEXT_INVALID', 'Distribution context is invalid.');
    }
    return context;
}
export function assertSafeFilename(value) {
    const filename = value.trim().normalize('NFKC');
    if (filename.length < 1 ||
        filename.length > 255 ||
        filename === '.' ||
        filename === '..' ||
        filename.includes('/') ||
        filename.includes('\\') ||
        Array.from(filename).some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint < 0x20 || codePoint === 0x7f;
        }) ||
        /(^|\.)\.(\.|$)/u.test(filename)) {
        throw new DomainError('UNSAFE_FILENAME', 'Filename is unsafe.');
    }
    return filename;
}
export function assertDeclaredFilePolicy(policy, input) {
    assertSafeFilename(input.filename);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
        throw new DomainError('FILE_SIZE_INVALID', 'Declared file size is invalid.');
    }
    if (input.sizeBytes > policy.maximumBytes) {
        throw new DomainError('FILE_TOO_LARGE', 'Declared file size exceeds project policy.');
    }
    if (!policy.allowedMediaTypes.includes(input.mediaType.toLocaleLowerCase('en-US'))) {
        throw new DomainError('FILE_TYPE_UNSUPPORTED', 'Declared media type is not supported.');
    }
    if (!/^[a-f0-9]{64}$/u.test(input.sha256)) {
        throw new DomainError('CHECKSUM_INVALID', 'SHA-256 must be lowercase hexadecimal.');
    }
}
const magicChecks = {
    'application/pdf': (bytes) => Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-',
    'image/png': (bytes) => bytes.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value),
    'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};
export function assertMagicBytes(mediaType, bytes) {
    const check = magicChecks[mediaType.toLocaleLowerCase('en-US')];
    if (check !== undefined && !check(bytes)) {
        throw new DomainError('MIME_MAGIC_MISMATCH', 'Declared media type does not match file bytes.');
    }
    if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
        throw new DomainError('EXECUTABLE_CONTENT_FORBIDDEN', 'Executable content is forbidden.');
    }
}
export function sha256Hex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
export function assertUploadCompletion(input) {
    if (input.expiresAt.getTime() <= input.now.getTime()) {
        throw new DomainError('UPLOAD_SESSION_EXPIRED', 'Upload session has expired.');
    }
    if (input.status !== 'Uploading' && input.status !== 'Pending') {
        throw new DomainError('UPLOAD_SESSION_NOT_COMPLETABLE', 'Upload session cannot be completed.');
    }
    if (input.actualSize !== input.declaredSize) {
        throw new DomainError('UPLOAD_INCOMPLETE', 'Uploaded size does not match the declaration.');
    }
    if (input.actualSha256 !== input.declaredSha256) {
        throw new DomainError('CHECKSUM_MISMATCH', 'Uploaded checksum does not match the declaration.');
    }
}
export function assertAnnotation(input) {
    if (!Number.isInteger(input.page) || input.page < 1) {
        throw new DomainError('ANNOTATION_PAGE_INVALID', 'Annotation page must be a positive integer.');
    }
    if (![input.x, input.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)) {
        throw new DomainError('ANNOTATION_COORDINATES_INVALID', 'Annotation coordinates must be normalized to 0-1.');
    }
    if (!['pin', 'note', 'highlight', 'area'].includes(input.kind)) {
        throw new DomainError('ANNOTATION_KIND_INVALID', 'Annotation kind is invalid.');
    }
    if ((input.body?.length ?? 0) > 4_000) {
        throw new DomainError('ANNOTATION_BODY_TOO_LONG', 'Annotation body is too long.');
    }
}
export function signedUrlExpiry(now, ttlSeconds) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 15 || ttlSeconds > 300) {
        throw new DomainError('SIGNED_URL_TTL_INVALID', 'Signed URL TTL must be between 15 and 300 seconds.');
    }
    return new Date(now.getTime() + ttlSeconds * 1_000);
}
export function assertSingleCurrentRevision(input) {
    const currentCount = input.revisions.filter((rev) => rev.isCurrent === true || rev.status === 'Published').length;
    if (currentCount > 1) {
        throw new DomainError('MULTIPLE_CURRENT_REVISIONS_FORBIDDEN', 'Only a single revision may be current or published at any time.');
    }
}
export function generateTransmittalSignature(snapshotSha256, secret) {
    if (!/^[a-f0-9]{64}$/u.test(snapshotSha256)) {
        throw new DomainError('SNAPSHOT_HASH_INVALID', 'Snapshot SHA-256 is invalid.');
    }
    return createHash('sha256')
        .update(`${snapshotSha256}:${secret}`)
        .digest('hex');
}
export function buildDrawingQrPayload(input) {
    const data = {
        tId: input.transmittalId,
        doc: input.documentCode,
        rev: input.revisionCode,
        sha: input.fileSha256.slice(0, 16),
        sig: input.signature.slice(0, 16),
        iat: input.issuedAt,
    };
    return Buffer.from(JSON.stringify(data)).toString('base64url');
}
