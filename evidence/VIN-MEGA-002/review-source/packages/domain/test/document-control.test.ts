import { describe, expect, it } from 'vitest';
import {
  assertAnnotation,
  assertDeclaredFilePolicy,
  assertMagicBytes,
  assertPublishAllowed,
  assertReviewerMayDecide,
  assertSafeFilename,
  assertUploadCompletion,
  assertWithdrawAllowed,
  DomainError,
  evaluateReviewRoute,
  normalizeContextKey,
  revisionTransitionTarget,
  signedUrlExpiry,
} from '../src/index.js';

function expectCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  if (caught instanceof DomainError) expect(caught.code).toBe(code);
}

describe('Document Control domain invariants', () => {
  it('allows only the approved revision lifecycle and never infers current', () => {
    expect(revisionTransitionTarget('Draft', 'submit_review')).toBe('Under Review');
    expect(revisionTransitionTarget('Under Review', 'approve')).toBe('Approved');
    expect(revisionTransitionTarget('Approved', 'publish')).toBe('Published');
    expectCode(() => revisionTransitionTarget('Draft', 'publish'), 'INVALID_REVISION_TRANSITION');
    expectCode(
      () => revisionTransitionTarget('Published', 'withdraw'),
      'INVALID_REVISION_TRANSITION',
    );
  });

  it('requires a withdrawal reason and refuses current revision withdrawal', () => {
    expect(() =>
      assertWithdrawAllowed({ status: 'Draft', isCurrent: false, reason: 'obsolete' }),
    ).not.toThrow();
    expectCode(
      () => assertWithdrawAllowed({ status: 'Draft', isCurrent: true, reason: 'obsolete' }),
      'CURRENT_REVISION_WITHDRAW_FORBIDDEN',
    );
    expectCode(
      () => assertWithdrawAllowed({ status: 'Under Review', isCurrent: false, reason: '' }),
      'WITHDRAW_REASON_REQUIRED',
    );
  });

  it('evaluates configurable sequential and quorum routes without editing decisions', () => {
    const assignments = [
      { reviewerId: 'reviewer-a', sequence: 1, decision: 'approve' as const },
      { reviewerId: 'reviewer-b', sequence: 2, decision: null },
      { reviewerId: 'reviewer-c', sequence: 2, decision: null },
    ];
    expect(
      evaluateReviewRoute(
        { mode: 'sequential', requiredApprovals: 2, rejectThreshold: 1 },
        assignments,
      ),
    ).toMatchObject({ completed: false, actionableReviewerIds: ['reviewer-b', 'reviewer-c'] });
    expect(
      evaluateReviewRoute({ mode: 'quorum', requiredApprovals: 2, rejectThreshold: 1 }, [
        assignments[0]!,
        { ...assignments[1]!, decision: 'approve_with_comments' },
        assignments[2]!,
      ]),
    ).toMatchObject({ completed: true, outcome: 'approved_with_comments' });
    expectCode(
      () =>
        assertReviewerMayDecide({
          actorUserId: 'maker',
          makerUserId: 'maker',
          actionableReviewerIds: ['maker'],
          existingDecision: false,
        }),
      'MAKER_CHECKER_VIOLATION',
    );
    expectCode(
      () =>
        assertReviewerMayDecide({
          actorUserId: 'reviewer-a',
          makerUserId: 'maker',
          actionableReviewerIds: ['reviewer-a'],
          existingDecision: true,
        }),
      'REVIEW_DECISION_IMMUTABLE',
    );
  });

  it('guards publish by state, file, route, mandatory disposition, and maker-checker', () => {
    expect(() =>
      assertPublishAllowed({
        status: 'Approved with Comments',
        fileStatus: 'Available',
        routeCompleted: true,
        unresolvedMandatoryComments: 0,
        makerUserId: 'maker',
        publisherUserId: 'controller',
      }),
    ).not.toThrow();
    expectCode(
      () =>
        assertPublishAllowed({
          status: 'Approved with Comments',
          fileStatus: 'Available',
          routeCompleted: true,
          unresolvedMandatoryComments: 1,
          makerUserId: 'maker',
          publisherUserId: 'controller',
        }),
      'MANDATORY_COMMENT_DISPOSITION_REQUIRED',
    );
  });

  it('enforces upload policy, safe filename, magic bytes, checksum completion, and expiry', () => {
    const policy = { maximumBytes: 10_000, allowedMediaTypes: ['application/pdf', 'image/png'] };
    expect(() =>
      assertDeclaredFilePolicy(policy, {
        sizeBytes: 5,
        mediaType: 'application/pdf',
        filename: 'drawing.pdf',
        sha256: 'a'.repeat(64),
      }),
    ).not.toThrow();
    expectCode(() => assertSafeFilename('../drawing.pdf'), 'UNSAFE_FILENAME');
    expectCode(
      () => assertMagicBytes('application/pdf', Buffer.from('not-pdf')),
      'MIME_MAGIC_MISMATCH',
    );
    expectCode(
      () =>
        assertUploadCompletion({
          declaredSize: 5,
          actualSize: 4,
          declaredSha256: 'a'.repeat(64),
          actualSha256: 'a'.repeat(64),
          expiresAt: new Date('2030-01-01T00:00:00Z'),
          now: new Date('2029-01-01T00:00:00Z'),
          status: 'Uploading',
        }),
      'UPLOAD_INCOMPLETE',
    );
  });

  it('validates normalized annotations, configurable contexts, and short URL TTLs', () => {
    expect(() =>
      assertAnnotation({ page: 1, x: 0, y: 1, kind: 'pin', body: '<script>' }),
    ).not.toThrow();
    expectCode(
      () => assertAnnotation({ page: 0, x: -0.1, y: 2, kind: 'pin' }),
      'ANNOTATION_PAGE_INVALID',
    );
    expect(normalizeContextKey(undefined)).toBe('default');
    expect(signedUrlExpiry(new Date('2026-01-01T00:00:00Z'), 60).toISOString()).toBe(
      '2026-01-01T00:01:00.000Z',
    );
  });
});
