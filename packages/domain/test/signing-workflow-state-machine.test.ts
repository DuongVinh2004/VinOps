import { describe, expect, it } from 'vitest';
import {
  assertCanSign,
  buildDossierHashChain,
  canSign,
  nextState,
  ORDER_TO_ROLE,
  ROLE_TO_ORDER,
} from '../src/pki/signing-workflow-state-machine.js';

describe('Signing Workflow State Machine & Hash Chain (ADR015-DOM-04)', () => {
  describe('nextState transitions', () => {
    it('handles normal sequential flow: pending -> otp_sent -> signed', () => {
      const state1 = nextState('pending', 'authorize');
      expect(state1).toBe('otp_sent');

      const state2 = nextState(state1, 'sign');
      expect(state2).toBe('signed');
    });

    it('handles rejection from pending or otp_sent', () => {
      expect(nextState('pending', 'reject')).toBe('rejected');
      expect(nextState('otp_sent', 'reject')).toBe('rejected');
    });

    it('handles expiration from pending or otp_sent', () => {
      expect(nextState('pending', 'expire')).toBe('expired');
      expect(nextState('otp_sent', 'expire')).toBe('expired');
    });

    it('handles skipping for downstream sessions when previous was rejected', () => {
      expect(nextState('pending', 'skip')).toBe('skipped');
    });

    it('permits OTP re-transmission in otp_sent state', () => {
      expect(nextState('otp_sent', 'authorize')).toBe('otp_sent');
    });

    it('rejects illegal transitions with DomainError', () => {
      expect(() => nextState('signed', 'sign')).toThrow(
        'Cannot perform action "sign" from state "signed"',
      );
      expect(() => nextState('rejected', 'authorize')).toThrow(
        'Cannot perform action "authorize" from state "rejected"',
      );
      expect(() => nextState('expired', 'sign')).toThrow(
        'Cannot perform action "sign" from state "expired"',
      );
      expect(() => nextState('pending', 'sign')).toThrow(
        'Cannot perform action "sign" from state "pending"',
      );
    });
  });

  describe('canSign and assertCanSign sequential rules', () => {
    const now = new Date('2026-09-07T12:00:00Z');
    const futureExpiry = new Date('2026-09-08T12:00:00Z');
    const pastExpiry = new Date('2026-09-07T10:00:00Z');

    it('allows contractor (order 1) to sign without previous session', () => {
      expect(canSign('pending', 'contractor_rep', 1, undefined, futureExpiry, now)).toBe(true);
      expect(() =>
        assertCanSign('pending', 'contractor_rep', 1, undefined, futureExpiry, now),
      ).not.toThrow();
    });

    it('prevents TVGS (order 2) from signing if contractor (order 1) has not signed', () => {
      expect(canSign('pending', 'tvgs_lead', 2, 'pending', futureExpiry, now)).toBe(false);
      expect(canSign('pending', 'tvgs_lead', 2, 'otp_sent', futureExpiry, now)).toBe(false);
      expect(() => assertCanSign('pending', 'tvgs_lead', 2, 'pending', futureExpiry, now)).toThrow(
        'Step 2 requires step 1 to be completed before signing.',
      );
    });

    it('allows TVGS (order 2) to sign once contractor (order 1) is signed', () => {
      expect(canSign('pending', 'tvgs_lead', 2, 'signed', futureExpiry, now)).toBe(true);
      expect(() =>
        assertCanSign('pending', 'tvgs_lead', 2, 'signed', futureExpiry, now),
      ).not.toThrow();
    });

    it('prevents PMU (order 3) if TVGS (order 2) is not signed', () => {
      expect(canSign('pending', 'pmu_manager', 3, 'otp_sent', futureExpiry, now)).toBe(false);
      expect(() =>
        assertCanSign('pending', 'pmu_manager', 3, 'otp_sent', futureExpiry, now),
      ).toThrow('Step 3 requires step 2 to be completed before signing.');
    });

    it('allows PMU (order 3) once TVGS (order 2) is signed', () => {
      expect(canSign('pending', 'pmu_manager', 3, 'signed', futureExpiry, now)).toBe(true);
      expect(() =>
        assertCanSign('pending', 'pmu_manager', 3, 'signed', futureExpiry, now),
      ).not.toThrow();
    });

    it('rejects if role does not match order', () => {
      expect(canSign('pending', 'pmu_manager', 1, undefined, futureExpiry, now)).toBe(false);
      expect(() =>
        assertCanSign('pending', 'pmu_manager', 1, undefined, futureExpiry, now),
      ).toThrow('Role "pmu_manager" is not authorized for signing step 1');
    });

    it('rejects if session is expired', () => {
      expect(canSign('pending', 'contractor_rep', 1, undefined, pastExpiry, now)).toBe(false);
      expect(() =>
        assertCanSign('pending', 'contractor_rep', 1, undefined, pastExpiry, now),
      ).toThrow('The signing session has expired.');
    });

    it('verifies ORDER_TO_ROLE and ROLE_TO_ORDER consistency', () => {
      expect(ORDER_TO_ROLE[1]).toBe('contractor_rep');
      expect(ORDER_TO_ROLE[2]).toBe('tvgs_lead');
      expect(ORDER_TO_ROLE[3]).toBe('pmu_manager');
      expect(ROLE_TO_ORDER.contractor_rep).toBe(1);
      expect(ROLE_TO_ORDER.tvgs_lead).toBe(2);
      expect(ROLE_TO_ORDER.pmu_manager).toBe(3);
    });
  });

  describe('As-Built Dossier Cryptographic Hash Chain', () => {
    it('builds linear tamper-evident hash chain from items', () => {
      const metadata = {
        code: 'DOS-GD1-CT01',
        name: 'Hồ sơ Nghiệm thu Tháp A',
        dossierType: 'stage_acceptance',
      };

      const items = [
        {
          itemId: 'item-01',
          itemHash: '4a7d1ed414474e4033ac29ccb8653d9b12852eb3e4fb2d77d701aa80c47d337a',
          sequence: 1,
          itemType: 'acceptance_record',
        },
        {
          itemId: 'item-02',
          itemHash: '5b8e2fe525585f5144bd30ddc9764e0c23963fc4f50c3e88e812bb91d58e448b',
          sequence: 2,
          itemType: 'test_report',
        },
      ];

      const result = buildDossierHashChain(items, metadata);

      expect(result.nodes).toHaveLength(3); // metadata (0) + 2 items
      expect(result.nodes[0]!.itemType).toBe('metadata');
      expect(result.nodes[0]!.index).toBe(0);
      expect(result.nodes[1]!.itemType).toBe('acceptance_record');
      expect(result.nodes[1]!.index).toBe(1);
      expect(result.nodes[2]!.itemType).toBe('test_report');
      expect(result.nodes[2]!.index).toBe(2);

      expect(result.sealedHash).toBe(result.nodes[2]!.nodeHash);
      expect(result.sealedHash).toMatch(/^[0-9a-f]{64}$/);

      // Verify determinism: identical items produce identical sealedHash
      const result2 = buildDossierHashChain(items, metadata);
      expect(result2.sealedHash).toBe(result.sealedHash);

      // Verify tamper-evidence: modifying any item changes sealedHash
      const tamperedItems = [
        {
          ...items[0]!,
          itemHash: '0000000000000000000000000000000000000000000000000000000000000000',
        },
        items[1]!,
      ];
      const tamperedResult = buildDossierHashChain(tamperedItems, metadata);
      expect(tamperedResult.sealedHash).not.toBe(result.sealedHash);
    });
  });
});
