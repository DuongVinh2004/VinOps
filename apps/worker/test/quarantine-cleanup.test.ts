import { describe, expect, it, vi } from 'vitest';
import type { VinopsDatabase } from '@vinops/database';
import type { ObjectStorage } from '@vinops/file';
import { createDocumentEventHandlers } from '../src/document-event-handler.js';
import { QuarantineCleanupWorker } from '../src/quarantine-cleanup-worker.js';
import type { OutboxEvent } from '../src/outbox-publisher.js';

describe('Quarantine cleanup worker & Document event handlers', () => {
  it('handles document.published and revision.submitted outbox events', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const { handler, metrics } = createDocumentEventHandlers(logger);

    const publishedEvent: OutboxEvent = {
      id: 'e-1',
      aggregateType: 'document_revision',
      aggregateId: 'rev-1',
      eventType: 'revision.published.v1',
      payload: { revision_id: 'rev-1', document_id: 'doc-1' },
      publishAttempts: 1,
      tenant: { organizationId: 'org-1', projectId: 'prj-1' },
      correlationId: 'c-1',
    };

    await handler(publishedEvent);
    expect(metrics.publishedCount).toBe(1);
    expect(logger.info).toHaveBeenCalledTimes(1);

    const submittedEvent: OutboxEvent = {
      id: 'e-2',
      aggregateType: 'document_revision',
      aggregateId: 'rev-2',
      eventType: 'revision.submitted',
      payload: { revision_id: 'rev-2', document_id: 'doc-2' },
      publishAttempts: 1,
      tenant: { organizationId: 'org-1', projectId: 'prj-1' },
      correlationId: 'c-2',
    };

    await handler(submittedEvent);
    expect(metrics.submittedCount).toBe(1);
  });

  it('purges quarantine files older than 24 hours', async () => {
    const cleanupSessionsMock = vi.fn().mockResolvedValue(1);
    const claimQuarantineMock = vi.fn().mockResolvedValue([
      { id: 'f-1', quarantine_object_key: 'quarantine/f-1/original' },
      { id: 'f-2', quarantine_object_key: 'quarantine/f-2/original' },
    ]);
    const purgeQuarantineMock = vi.fn().mockResolvedValue(true);

    const deleteObjectMock = vi.fn().mockResolvedValue(undefined);
    const fakeDatabase = {
      withOutboxWorkerTransaction: vi
        .fn()
        .mockImplementation(
          (
            _opts: unknown,
            callback: (tx: {
              cleanupExpiredUploadSessions: typeof cleanupSessionsMock;
              claimExpiredQuarantineFiles: typeof claimQuarantineMock;
              purgeQuarantineFile: typeof purgeQuarantineMock;
            }) => Promise<unknown>,
          ) =>
            callback({
              cleanupExpiredUploadSessions: cleanupSessionsMock,
              claimExpiredQuarantineFiles: claimQuarantineMock,
              purgeQuarantineFile: purgeQuarantineMock,
            }),
        ),
    } as unknown as VinopsDatabase;

    const fakeStorage = {
      deleteObject: deleteObjectMock,
    } as unknown as ObjectStorage;

    const logger = { info: vi.fn(), error: vi.fn() };
    const fixedNow = new Date('2026-09-07T12:00:00.000Z');

    const worker = new QuarantineCleanupWorker(
      fakeDatabase,
      fakeStorage,
      logger,
      'test-worker',
      () => fixedNow,
    );

    const report = await worker.runOnce(24);
    expect(report.swept).toBe(2);
    expect(report.purged).toBe(2);
    expect(report.errors).toBe(0);

    expect(deleteObjectMock).toHaveBeenCalledWith('quarantine/f-1/original');
    expect(deleteObjectMock).toHaveBeenCalledWith('quarantine/f-2/original');
  });
});
