import { describe, expect, it } from 'vitest';
import {
  assertIssueMutable,
  assertValidSeverity,
  calculateGpsDistanceMeters,
  issueTransitionTarget,
  suggestContractor,
  validateGpsCoordinates,
} from '../src/field-issues/index.js';
import { DomainError } from '../src/errors.js';

describe('Field Issues Domain', () => {
  describe('State Machine', () => {
    it('allows valid state transitions', () => {
      expect(issueTransitionTarget('Open', 'triage')).toBe('Under Triage');
      expect(issueTransitionTarget('Open', 'assign')).toBe('Assigned');
      expect(issueTransitionTarget('Under Triage', 'assign')).toBe('Assigned');
      expect(issueTransitionTarget('Assigned', 'start_progress')).toBe('In Progress');
      expect(issueTransitionTarget('In Progress', 'resolve')).toBe('Resolved');
      expect(issueTransitionTarget('Resolved', 'close')).toBe('Closed');
      expect(issueTransitionTarget('Resolved', 'reopen')).toBe('Open');
      expect(issueTransitionTarget('Closed', 'reopen')).toBe('Open');
    });

    it('rejects invalid state transitions', () => {
      expect(() => issueTransitionTarget('Open', 'resolve')).toThrow(DomainError);
      expect(() => issueTransitionTarget('Open', 'close')).toThrow(DomainError);
      expect(() => issueTransitionTarget('In Progress', 'close')).toThrow(DomainError);
      expect(() => issueTransitionTarget('Closed', 'resolve')).toThrow(DomainError);
    });

    it('validates issue mutability and severities', () => {
      expect(() => assertIssueMutable('Open')).not.toThrow();
      expect(() => assertIssueMutable('In Progress')).not.toThrow();
      expect(() => assertIssueMutable('Closed')).toThrow(DomainError);

      expect(() => assertValidSeverity('critical')).not.toThrow();
      expect(() => assertValidSeverity('super_urgent')).toThrow(DomainError);
    });
  });

  describe('GPS Coordinates', () => {
    it('validates valid GPS coordinates and distances', () => {
      const p1 = { latitude: 10.762622, longitude: 106.660172, accuracyMeters: 5 };
      const p2 = { latitude: 10.763, longitude: 106.6605, accuracyMeters: 10 };

      expect(() => validateGpsCoordinates(p1)).not.toThrow();
      expect(() => validateGpsCoordinates(p2)).not.toThrow();

      const distance = calculateGpsDistanceMeters(p1, p2);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(100);
    });

    it('rejects out-of-range GPS coordinates', () => {
      expect(() => validateGpsCoordinates({ latitude: 95, longitude: 100 })).toThrow(DomainError);
      expect(() => validateGpsCoordinates({ latitude: 10, longitude: 200 })).toThrow(DomainError);
      expect(() =>
        validateGpsCoordinates({ latitude: 10, longitude: 100, accuracyMeters: -1 }),
      ).toThrow(DomainError);
    });
  });

  describe('Contractor Suggestion', () => {
    const candidates = [
      {
        partnerOrganizationId: 'partner-1',
        code: 'ELEC-CO',
        name: 'Electric Contractor',
        trades: ['electrical', 'mep'],
      },
      {
        partnerOrganizationId: 'partner-2',
        code: 'STRUCT-CO',
        name: 'Structure Contractor',
        trades: ['structure', 'concrete'],
      },
    ];

    it('suggests contractor from direct work node owner', () => {
      const suggested = suggestContractor(candidates, {
        workNodeOwnerPartnerOrganizationId: 'partner-2',
      });
      expect(suggested?.partnerOrganizationId).toBe('partner-2');
    });

    it('suggests contractor matching category or trade keyword', () => {
      const suggested = suggestContractor(candidates, {
        category: 'electrical',
      });
      expect(suggested?.partnerOrganizationId).toBe('partner-1');
    });

    it('falls back gracefully if no match', () => {
      const suggested = suggestContractor(candidates, {
        category: 'painting',
      });
      expect(suggested).toBeDefined();
    });
  });
});
