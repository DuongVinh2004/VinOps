import { createHash, randomUUID } from 'node:crypto';
import type { StructuredLogger as Logger } from '@vinops/observability';
import { describe, expect, it, vi } from 'vitest';
import type {
  FileProcessingClaim,
  OutboxWorkerTransaction,
  VinopsDatabase,
} from '@vinops/database';
import type { MalwareScanner, ObjectStorage } from '@vinops/file';
import { FileProcessingWorker } from '../apps/worker/src/file-processing-worker.js';
import {
  DeterministicInProcessPublisher,
  type OutboxEvent,
} from '../apps/worker/src/outbox-publisher.js';
import { OutboxWorker, type OutboxWorkerStore } from '../apps/worker/src/outbox-worker.js';

function createDummyLogger(): Pick<Logger, 'info' | 'error'> {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

function createDummyEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: randomUUID(),
    aggregateType: 'project',
    aggregateId: randomUUID(),
    eventType: 'document.published.v1',
    payload: { version: 1 },
    publishAttempts: 1,
    tenant: {
      organizationId: randomUUID(),
      projectId: randomUUID(),
    },
    correlationId: randomUUID(),
    ...overrides,
  };
}

describe('Worker Fault Injection & Resilience Test Suite', () => {
  describe('Outbox Idempotency (Duplicate Trigger Handling)', () => {
    it('ensures duplicate event triggers are strictly deduplicated and executed only once', async () => {
      const handler = vi.fn();
      const publisher = new DeterministicInProcessPublisher([handler]);
      const event = createDummyEvent();

      // Trigger the event first time
      await publisher.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(publisher.deliveries).toHaveLength(1);
      expect(publisher.deliveries[0]!.id).toBe(event.id);

      // Trigger the exact same event second time (duplicate delivery / replay)
      await publisher.publish(event);

      // Handler must NOT be invoked again; deliveries list remains unchanged
      expect(handler).toHaveBeenCalledTimes(1);
      expect(publisher.deliveries).toHaveLength(1);
    });

    it('guarantees worker handles duplicate claim/publish cycles idempotently without re-triggering side effects', async () => {
      const event = createDummyEvent();
      let publishedCount = 0;
      const publishedEvents = new Set<string>();

      const mockStore: OutboxWorkerStore = {
        claim: vi.fn().mockImplementation(() => {
          if (publishedEvents.has(event.id)) {
            return Promise.resolve([]);
          }
          return Promise.resolve([event]);
        }),
        markPublished: vi.fn().mockImplementation((evt: OutboxEvent) => {
          publishedCount++;
          publishedEvents.add(evt.id);
          return Promise.resolve();
        }),
        markFailed: vi.fn().mockResolvedValue(undefined),
      };

      const handler = vi.fn();
      const publisher = new DeterministicInProcessPublisher([handler]);
      const worker = new OutboxWorker(mockStore, publisher, createDummyLogger(), {
        workerName: 'fault-idempotency-worker',
        correlationId: randomUUID,
      });

      // Run 1: Claim and publish
      const report1 = await worker.runOnce();
      expect(report1).toEqual({ claimed: 1, published: 1, failed: 0, exhausted: 0 });
      expect(publishedCount).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);

      // Run 2: Redundant trigger attempt (claim yields nothing or duplicate ignored)
      const report2 = await worker.runOnce();
      expect(report2).toEqual({ claimed: 0, published: 0, failed: 0, exhausted: 0 });
      expect(publishedCount).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Worker Crash & Recovery (No Lost Events)', () => {
    it('recovers from worker crash midway without losing pending outbox events', async () => {
      const event = createDummyEvent();
      let eventState: 'Pending' | 'Claimed' | 'Published' = 'Pending';
      let attempts = 0;
      const deliveryCollector: OutboxEvent[] = [];

      // Shared persistent-like store simulating Postgres outbox table
      const simulatedStore: OutboxWorkerStore = {
        claim: vi.fn().mockImplementation(() => {
          if (eventState === 'Pending') {
            eventState = 'Claimed';
            attempts++;
            return Promise.resolve([{ ...event, publishAttempts: attempts }]);
          }
          return Promise.resolve([]);
        }),
        markPublished: vi.fn().mockImplementation((evt: OutboxEvent) => {
          eventState = 'Published';
          deliveryCollector.push(evt);
          return Promise.resolve();
        }),
        markFailed: vi.fn().mockImplementation(() => {
          // Crash or failure releases the event back to Pending for retry
          eventState = 'Pending';
          return Promise.resolve();
        }),
      };

      // Worker 1: Crashes midway through execution before markPublished
      const crashPublisher = {
        publish: vi.fn().mockRejectedValue(new Error('CRASH_SIMULATION_WORKER_SIGKILL')),
      };

      const crashingWorker = new OutboxWorker(simulatedStore, crashPublisher, createDummyLogger(), {
        workerName: 'crash-worker-instance-1',
        correlationId: randomUUID,
      });

      const crashReport = await crashingWorker.runOnce();
      expect(crashReport.failed).toBe(1);
      expect(crashReport.published).toBe(0);
      expect(eventState).toBe('Pending'); // Event was NOT lost
      expect(attempts).toBe(1);
      expect(deliveryCollector).toHaveLength(0);

      // Worker 2: Restarted worker instance after crash
      const recoveredHandler = vi.fn();
      const normalPublisher = new DeterministicInProcessPublisher([recoveredHandler]);
      const restartedWorker = new OutboxWorker(
        simulatedStore,
        normalPublisher,
        createDummyLogger(),
        {
          workerName: 'restarted-worker-instance-2',
          correlationId: randomUUID,
        },
      );

      const recoveredReport = await restartedWorker.runOnce();
      expect(recoveredReport.claimed).toBe(1);
      expect(recoveredReport.published).toBe(1);
      expect(eventState).toBe('Published');
      expect(attempts).toBe(2);
      expect(recoveredHandler).toHaveBeenCalledTimes(1);
      expect(deliveryCollector).toHaveLength(1);
      expect(deliveryCollector[0]!.id).toBe(event.id);
    });
  });

  describe('ClamAV Fault Injection & Quarantine Isolation', () => {
    const validPdfBytes = Buffer.from('%PDF-1.7\n% clean payload\n%%EOF\n', 'utf8');
    const validSha256 = createHash('sha256').update(validPdfBytes).digest('hex');

    function createMockClaim(overrides: Partial<FileProcessingClaim> = {}): FileProcessingClaim {
      const fileId = randomUUID();
      return {
        job_id: randomUUID(),
        file_id: fileId,
        organization_id: randomUUID(),
        project_id: randomUUID(),
        job_type: 'validate_scan_preview',
        storage_bucket: 'vinops-files',
        quarantine_object_key: `quarantine/${fileId}/original`,
        declared_size_bytes: String(validPdfBytes.byteLength),
        declared_media_type: 'application/pdf',
        declared_sha256: validSha256,
        original_filename: 'document.pdf',
        attempts: 1,
        ...overrides,
      };
    }

    it('isolates infected file when ClamAV detects malware without promoting to Available', async () => {
      const claim = createMockClaim();
      const copyObjectSpy = vi.fn().mockResolvedValue(undefined);
      const mockStorage: ObjectStorage = {
        getObject: vi.fn().mockResolvedValue(validPdfBytes),
        putObject: vi.fn().mockResolvedValue(undefined),
        copyObject: copyObjectSpy,
        deleteObject: vi.fn().mockResolvedValue(undefined),
        headObject: vi.fn().mockResolvedValue({
          sizeBytes: validPdfBytes.length,
          contentType: 'application/pdf',
        }),
        createMultipartUpload: vi.fn().mockResolvedValue('mp-id'),
        authorizeUploadPart: vi.fn().mockResolvedValue('http://part-url'),
        completeMultipartUpload: vi.fn().mockResolvedValue(undefined),
        authorizeGet: vi.fn().mockResolvedValue('http://get-url'),
        authorizePut: vi.fn().mockResolvedValue('http://put-url'),
      } as unknown as ObjectStorage;

      const mockScanner: MalwareScanner = {
        scan: vi.fn().mockResolvedValue({
          outcome: 'infected',
          engine: 'clamav',
          signatureVersion: '2026.09.08',
          threatName: 'Eicar-Test-Signature',
        }),
      };

      let completedResult: unknown = null;
      const mockTx = {
        claimOutboxEvents: vi.fn().mockResolvedValue([]),
        markOutboxPublished: vi.fn().mockResolvedValue(undefined),
        markOutboxFailed: vi.fn().mockResolvedValue(undefined),
        claimFileProcessingJobs: vi.fn().mockResolvedValue([claim]),
        completeFileProcessing: vi.fn().mockImplementation((input) => {
          completedResult = input;
          return Promise.resolve();
        }),
        retryFileProcessingJob: vi.fn().mockResolvedValue(undefined),
        completeFileReconciliation: vi.fn().mockResolvedValue(undefined),
      };

      const mockDatabase = {
        withOutboxWorkerTransaction: vi.fn(
          <T>(_ctx: unknown, op: (tx: OutboxWorkerTransaction) => Promise<T>) =>
            op(mockTx as unknown as OutboxWorkerTransaction),
        ),
      } as unknown as VinopsDatabase;

      const worker = new FileProcessingWorker(
        mockDatabase,
        mockStorage,
        mockScanner,
        createDummyLogger(),
        'test-malware-worker',
      );

      const report = await worker.runOnce(1);
      expect(report.claimed).toBe(1);
      expect(report.rejected).toBe(1);
      expect(report.available).toBe(0);

      // Verify file is marked as Rejected with MALWARE_DETECTED
      expect(completedResult).toMatchObject({
        fileId: claim.file_id,
        result: 'Rejected',
        failureCode: 'MALWARE_DETECTED',
        availableObjectKey: null,
      });

      // Quarantine isolation: copyObject was NEVER called to promote to available storage
      expect(copyObjectSpy).not.toHaveBeenCalled();
    });

    it('keeps file in quarantine when ClamAV returns SCAN_TIMEOUT without promoting to Available', async () => {
      const claim = createMockClaim();
      const copyObjectSpy = vi.fn().mockResolvedValue(undefined);
      const mockStorage: ObjectStorage = {
        getObject: vi.fn().mockResolvedValue(validPdfBytes),
        putObject: vi.fn().mockResolvedValue(undefined),
        copyObject: copyObjectSpy,
        deleteObject: vi.fn().mockResolvedValue(undefined),
        headObject: vi.fn().mockResolvedValue({
          sizeBytes: validPdfBytes.length,
          contentType: 'application/pdf',
        }),
        createMultipartUpload: vi.fn().mockResolvedValue('mp-id'),
        authorizeUploadPart: vi.fn().mockResolvedValue('http://part-url'),
        completeMultipartUpload: vi.fn().mockResolvedValue(undefined),
        authorizeGet: vi.fn().mockResolvedValue('http://get-url'),
        authorizePut: vi.fn().mockResolvedValue('http://put-url'),
      } as unknown as ObjectStorage;

      const mockScanner: MalwareScanner = {
        scan: vi.fn().mockResolvedValue({
          outcome: 'error',
          engine: 'clamav',
          signatureVersion: '2026.09.08',
          errorCode: 'SCAN_TIMEOUT',
        }),
      };

      let completedResult: unknown = null;
      const mockTx = {
        claimOutboxEvents: vi.fn().mockResolvedValue([]),
        markOutboxPublished: vi.fn().mockResolvedValue(undefined),
        markOutboxFailed: vi.fn().mockResolvedValue(undefined),
        claimFileProcessingJobs: vi.fn().mockResolvedValue([claim]),
        completeFileProcessing: vi.fn().mockImplementation((input) => {
          completedResult = input;
          return Promise.resolve();
        }),
        retryFileProcessingJob: vi.fn().mockResolvedValue(undefined),
        completeFileReconciliation: vi.fn().mockResolvedValue(undefined),
      };

      const mockDatabase = {
        withOutboxWorkerTransaction: vi.fn(
          <T>(_ctx: unknown, op: (tx: OutboxWorkerTransaction) => Promise<T>) =>
            op(mockTx as unknown as OutboxWorkerTransaction),
        ),
      } as unknown as VinopsDatabase;

      const worker = new FileProcessingWorker(
        mockDatabase,
        mockStorage,
        mockScanner,
        createDummyLogger(),
        'test-timeout-worker',
      );

      const report = await worker.runOnce(1);
      expect(report.claimed).toBe(1);
      expect(report.rejected).toBe(1);
      expect(report.available).toBe(0);

      // Result must remain Quarantined (never Available)
      expect(completedResult).toMatchObject({
        fileId: claim.file_id,
        result: 'Quarantined',
        failureCode: 'SCAN_TIMEOUT',
        availableObjectKey: null,
      });

      // Storage copy to available key MUST NOT be invoked
      expect(copyObjectSpy).not.toHaveBeenCalled();
    });

    it('schedules retry and does not promote file when scanner throws an unexpected timeout exception', async () => {
      const claim = createMockClaim();
      const copyObjectSpy = vi.fn().mockResolvedValue(undefined);
      const mockStorage: ObjectStorage = {
        getObject: vi.fn().mockResolvedValue(validPdfBytes),
        putObject: vi.fn().mockResolvedValue(undefined),
        copyObject: copyObjectSpy,
        deleteObject: vi.fn().mockResolvedValue(undefined),
        headObject: vi.fn().mockResolvedValue({
          sizeBytes: validPdfBytes.length,
          contentType: 'application/pdf',
        }),
        createMultipartUpload: vi.fn().mockResolvedValue('mp-id'),
        authorizeUploadPart: vi.fn().mockResolvedValue('http://part-url'),
        completeMultipartUpload: vi.fn().mockResolvedValue(undefined),
        authorizeGet: vi.fn().mockResolvedValue('http://get-url'),
        authorizePut: vi.fn().mockResolvedValue('http://put-url'),
      } as unknown as ObjectStorage;

      const mockScanner: MalwareScanner = {
        scan: vi.fn().mockRejectedValue(new Error('SCAN_TIMEOUT')),
      };

      let retryPayload: unknown = null;
      let completedCalled = false;

      const mockTx = {
        claimOutboxEvents: vi.fn().mockResolvedValue([]),
        markOutboxPublished: vi.fn().mockResolvedValue(undefined),
        markOutboxFailed: vi.fn().mockResolvedValue(undefined),
        claimFileProcessingJobs: vi.fn().mockResolvedValue([claim]),
        completeFileProcessing: vi.fn().mockImplementation(() => {
          completedCalled = true;
          return Promise.resolve();
        }),
        retryFileProcessingJob: vi
          .fn()
          .mockImplementation((jobId: string, worker: string, err: string, next: Date | null) => {
            retryPayload = { jobId, worker, err, next };
            return Promise.resolve();
          }),
        completeFileReconciliation: vi.fn().mockResolvedValue(undefined),
      };

      const mockDatabase = {
        withOutboxWorkerTransaction: vi.fn(
          <T>(_ctx: unknown, op: (tx: OutboxWorkerTransaction) => Promise<T>) =>
            op(mockTx as unknown as OutboxWorkerTransaction),
        ),
      } as unknown as VinopsDatabase;

      const worker = new FileProcessingWorker(
        mockDatabase,
        mockStorage,
        mockScanner,
        createDummyLogger(),
        'test-exception-worker',
      );

      const report = await worker.runOnce(1);
      expect(report.claimed).toBe(1);
      expect(report.available).toBe(0);
      expect(report.retried).toBe(1);

      expect(completedCalled).toBe(false);
      expect(retryPayload).toMatchObject({
        jobId: claim.job_id,
        err: 'SCAN_TIMEOUT',
      });
      expect(copyObjectSpy).not.toHaveBeenCalled();
    });
  });
});
