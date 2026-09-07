import { describe, expect, it } from 'vitest';
import {
  assertAcceptanceSignSequence,
  assertCarIndependence,
  assertInspectionChecklistResult,
  assertDailyLogMutable,
  assertDailyLogConfirmation,
  assertValidGpsCoordinates,
  resolveOfflineConflict,
  DomainError,
} from '@vinops/domain';

describe('Domain: Quality & Acceptance (ND 207/2026/ND-CP & TT 32/2026/TT-BXD)', () => {
  it('enforces 3-party sequential signing: Contractor -> Supervisor -> PMU', () => {
    // Contractor signs first
    let status = assertAcceptanceSignSequence('Draft', 'contractor');
    expect(status).toBe('Contractor Signed');

    // Supervisor signs second
    status = assertAcceptanceSignSequence(status, 'supervisor');
    expect(status).toBe('Supervisor Signed');

    // PMU signs third and completes
    status = assertAcceptanceSignSequence(status, 'pmu');
    expect(status).toBe('Completed');
  });

  it('rejects out-of-order signing: Supervisor cannot sign before Contractor', () => {
    expect(() => assertAcceptanceSignSequence('Draft', 'supervisor')).toThrow(DomainError);
    expect(() => assertAcceptanceSignSequence('Draft', 'supervisor')).toThrow(
      /Contractor must sign before Supervisor/u,
    );
  });

  it('rejects out-of-order signing: PMU cannot sign before Supervisor', () => {
    expect(() => assertAcceptanceSignSequence('Contractor Signed', 'pmu')).toThrow(DomainError);
    expect(() => assertAcceptanceSignSequence('Contractor Signed', 'pmu')).toThrow(
      /Supervisor must sign before PMU/u,
    );
  });

  it('blocks signing on already Completed or Rejected records', () => {
    expect(() => assertAcceptanceSignSequence('Completed', 'contractor')).toThrow(
      /already Completed/u,
    );
    expect(() => assertAcceptanceSignSequence('Rejected', 'supervisor')).toThrow(
      /already Rejected/u,
    );
  });

  it('enforces CAR independence rule: performer cannot self-verify High/Critical findings', () => {
    const userA = 'user-001';
    const userB = 'user-002';

    // Different user is allowed
    expect(() => assertCarIndependence(userA, userB, 'Critical')).not.toThrow();
    expect(() => assertCarIndependence(userA, userB, 'High')).not.toThrow();

    // Same user allowed for Low / Medium
    expect(() => assertCarIndependence(userA, userA, 'Low')).not.toThrow();
    expect(() => assertCarIndependence(userA, userA, 'Medium')).not.toThrow();

    // Same user FORBIDDEN for High / Critical
    expect(() => assertCarIndependence(userA, userA, 'High')).toThrow(DomainError);
    expect(() => assertCarIndependence(userA, userA, 'High')).toThrow(
      /cannot self-verify and close a High severity finding/u,
    );
    expect(() => assertCarIndependence(userA, userA, 'Critical')).toThrow(DomainError);
    expect(() => assertCarIndependence(userA, userA, 'Critical')).toThrow(
      /cannot self-verify and close a Critical severity finding/u,
    );
  });

  it('validates checklist evidence requirements', () => {
    // Fail result requires evidence photo/document
    expect(() =>
      assertInspectionChecklistResult({
        result: 'Fail',
        requiresEvidence: false,
        evidenceFileIds: [],
        isMandatory: true,
      }),
    ).toThrow(DomainError);

    // Mandatory item cannot remain Pending
    expect(() =>
      assertInspectionChecklistResult({
        result: 'Pending',
        requiresEvidence: false,
        evidenceFileIds: [],
        isMandatory: true,
      }),
    ).toThrow(/cannot be left Pending/u);

    // Pass with evidence satisfies requirement
    expect(() =>
      assertInspectionChecklistResult({
        result: 'Pass',
        requiresEvidence: true,
        evidenceFileIds: ['file-uuid-1'],
        isMandatory: true,
      }),
    ).not.toThrow();
  });
});

describe('Domain: Electronic Daily Logs', () => {
  it('freezes confirmed daily logs against content modification', () => {
    expect(() => assertDailyLogMutable({ id: 'log-1', status: 'Draft' })).not.toThrow();

    expect(() => assertDailyLogMutable({ id: 'log-1', status: 'Submitted' })).not.toThrow();

    expect(() => assertDailyLogMutable({ id: 'log-1', status: 'Confirmed' })).toThrow(DomainError);
    expect(() => assertDailyLogMutable({ id: 'log-1', status: 'Confirmed' })).toThrow(
      /frozen against content modification/u,
    );
  });

  it('requires both Site Manager and TVGS signatures to confirm daily log', () => {
    expect(() =>
      assertDailyLogConfirmation({ siteManagerSigned: true, supervisorSigned: false }),
    ).toThrow(/requires both Site Manager and Supervisor signatures/u);

    expect(() =>
      assertDailyLogConfirmation({ siteManagerSigned: false, supervisorSigned: true }),
    ).toThrow(/requires both Site Manager and Supervisor signatures/u);

    expect(() =>
      assertDailyLogConfirmation({ siteManagerSigned: true, supervisorSigned: true }),
    ).not.toThrow();
  });

  it('validates GPS coordinates', () => {
    expect(() => assertValidGpsCoordinates(21.0285, 105.8542)).not.toThrow();
    expect(() => assertValidGpsCoordinates(95, 105)).toThrow(DomainError);
    expect(() => assertValidGpsCoordinates(21, 200)).toThrow(DomainError);
  });
});

describe('Domain: Offline Conflict Resolution', () => {
  const sampleOp = {
    operationId: 'op-001',
    deviceId: 'dev-001',
    entityType: 'daily_log' as const,
    entityTempId: 'tmp-001',
    command: 'update_summary',
    baseVersion: 2n,
    payload: { workSummary: 'Cap cong' },
    payloadHash: 'hash',
    clientCreatedAt: '2026-09-07T08:00:00.000Z',
  };

  it('applies cleanly on version match or new entity', () => {
    const resNew = resolveOfflineConflict(sampleOp, null);
    expect(resNew).toEqual({ action: 'apply_clean' });

    const resMatch = resolveOfflineConflict(sampleOp, {
      version: 2n,
      updatedAt: '2026-09-07T07:55:00.000Z',
    });
    expect(resMatch).toEqual({ action: 'apply_clean' });
  });

  it('rejects server-authoritative command when version drifts', () => {
    const signOp = { ...sampleOp, command: 'sign_supervisor', baseVersion: 1n };
    const res = resolveOfflineConflict(signOp, {
      version: 2n,
      updatedAt: '2026-09-07T07:55:00.000Z',
    });
    expect(res).toEqual({ action: 'reject', reason: 'server_authoritative' });
  });

  it('auto-merges checklist results and child logs on version drift', () => {
    const checklistOp = {
      ...sampleOp,
      entityType: 'inspection_result' as const,
      baseVersion: 1n,
      payload: { item_key: 'item_3', result: 'Pass' },
    };
    const res = resolveOfflineConflict(checklistOp, {
      version: 3n,
      updatedAt: '2026-09-07T08:10:00.000Z',
      fields: { item_1: 'Pass', item_2: 'Pass' },
    });
    expect(res.action).toBe('auto_merge');
  });

  it('flags needs_resolution when client timestamp is older than server update', () => {
    const editOp = {
      ...sampleOp,
      baseVersion: 1n,
      clientCreatedAt: '2026-09-07T07:00:00.000Z',
    };
    const res = resolveOfflineConflict(editOp, {
      version: 2n,
      updatedAt: '2026-09-07T08:00:00.000Z',
    });
    expect(res.action).toBe('needs_resolution');
  });
});
