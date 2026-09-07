import { describe, expect, it } from 'vitest';
import {
  DomainError,
  assertBreakGlassEffective,
  assertDelegationEffective,
  assertNoSensitiveSelfEscalation,
  assertProjectActivationPrerequisites,
  assertProjectMutable,
  assertResourceScope,
  assertTreeNodeChange,
  isMembershipEffective,
  projectTransitionTarget,
} from '../src/index.js';

function expectDomainCode(action: () => void, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  expect((thrown as DomainError).code).toBe(code);
}

const now = new Date('2026-07-30T12:00:00.000Z');

describe('platform domain invariants', () => {
  it('permits only the project lifecycle transitions from the approved candidate state machine', () => {
    expect(projectTransitionTarget('Setup', 'activate')).toBe('Active');
    expect(projectTransitionTarget('Archiving', 'complete_archive')).toBe('Archived');
    expect(() => projectTransitionTarget('Active', 'restore')).toThrow(DomainError);
  });

  it('blocks activation without all required foundations and project mutation while suspended', () => {
    expect(() =>
      assertProjectActivationPrerequisites({
        timezone: 'Asia/Bangkok',
        numberingProfileId: null,
        hasOwnerMembership: true,
      }),
    ).toThrow(/requires timezone/u);
    expect(() => assertProjectMutable('Suspended')).toThrow(/cannot be changed/u);
  });

  it('removes authorization immediately when a membership ends or is suspended', () => {
    expect(isMembershipEffective('Active', null, new Date('2026-07-30T12:01:00.000Z'), now)).toBe(
      true,
    );
    expect(isMembershipEffective('Ended', null, null, now)).toBe(false);
    expect(isMembershipEffective('Suspended', null, null, now)).toBe(false);
  });

  it('prevents sensitive self escalation and out-of-scope resource access', () => {
    expectDomainCode(
      () => assertNoSensitiveSelfEscalation('u-1', 'u-1', ['project_admin']),
      'SELF_ESCALATION_FORBIDDEN',
    );
    expectDomainCode(
      () =>
        assertResourceScope(
          [{ scopeType: 'work', scopeId: 'w-1', actions: ['read'] }],
          'read',
          'work',
          'w-2',
        ),
      'RESOURCE_SCOPE_DENIED',
    );
    expectDomainCode(
      () =>
        assertResourceScope(
          [{ scopeType: 'project', scopeId: 'project-1', actions: ['read'] }],
          'write',
          'work',
          'w-1',
        ),
      'RESOURCE_SCOPE_DENIED',
    );
  });

  it('expires delegation and break-glass access and validates tree cycles and sibling codes', () => {
    expectDomainCode(
      () =>
        assertDelegationEffective(
          {
            validFrom: new Date('2026-07-30T10:00:00.000Z'),
            validTo: new Date('2026-07-30T11:59:00.000Z'),
            reason: 'cover leave',
          },
          now,
        ),
      'DELEGATION_NOT_EFFECTIVE',
    );
    expectDomainCode(
      () =>
        assertBreakGlassEffective(
          {
            reason: '',
            approvedAt: null,
            validFrom: now,
            validTo: new Date('2026-07-30T12:31:00.000Z'),
            maxTtlMinutes: 30,
          },
          now,
        ),
      'BREAK_GLASS_NOT_EFFECTIVE',
    );
    expectDomainCode(
      () =>
        assertTreeNodeChange(
          [
            { id: 'root', parentId: null, code: 'R', archivedAt: null },
            { id: 'child', parentId: 'root', code: 'C', archivedAt: null },
          ],
          { id: 'root', parentId: 'child', code: 'R' },
        ),
      'TREE_CYCLE',
    );
  });
});
