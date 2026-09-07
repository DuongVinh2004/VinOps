import { describe, expect, it, vi } from 'vitest';
import { DeterministicInProcessPublisher, type OutboxEvent } from '../src/outbox-publisher.js';
import { PostgreSqlOutboxStore } from '../src/postgres-outbox-store.js';
import { outboxRetryDelayMs, scheduleOutboxRetry } from '../src/outbox-retry.js';
import { OutboxWorker, type OutboxWorkerStore } from '../src/outbox-worker.js';

const event: OutboxEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  aggregateType: 'project',
  aggregateId: '22222222-2222-4222-8222-222222222222',
  eventType: 'project.activated',
  payload: { secret: 'test-redacted-payload' },
  publishAttempts: 1,
  tenant: {
    organizationId: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
  },
  correlationId: '55555555-5555-4555-8555-555555555555',
};

function storeFor(events: readonly OutboxEvent[]): OutboxWorkerStore & {
  markPublished: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(events),
    markPublished: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe('outbox retry policy', () => {
  it('uses deterministic exponential retry delays capped at five minutes', () => {
    expect(outboxRetryDelayMs(1)).toBe(1_000);
    expect(outboxRetryDelayMs(3)).toBe(4_000);
    expect(outboxRetryDelayMs(99)).toBe(300_000);
  });

  it('stops retrying after the bounded maximum attempt count', () => {
    const now = new Date('2026-07-30T10:00:00.000Z');
    expect(scheduleOutboxRetry(now, 2, 3)).toEqual({
      retryAt: new Date('2026-07-30T10:00:02.000Z'),
      exhausted: false,
    });
    expect(scheduleOutboxRetry(now, 3, 3)).toEqual({ retryAt: null, exhausted: true });
  });
});

describe('outbox worker', () => {
  it('uses only the dedicated worker transaction boundary for claim and mark operations', async () => {
    const transaction = {
      claimOutboxEvents: vi.fn().mockResolvedValue([
        {
          id: event.id,
          organization_id: event.tenant.organizationId,
          project_id: event.tenant.projectId,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          event_type: event.eventType,
          payload: { correlation_id: event.correlationId },
          publish_attempts: event.publishAttempts,
        },
      ]),
      markOutboxPublished: vi.fn().mockResolvedValue(undefined),
      markOutboxFailed: vi.fn().mockResolvedValue(undefined),
    };
    const withOutboxWorkerTransaction = vi.fn(
      async (
        _context: unknown,
        operation: (workerTransaction: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );
    const store = new PostgreSqlOutboxStore({
      withOutboxWorkerTransaction,
    } as unknown as ConstructorParameters<typeof PostgreSqlOutboxStore>[0]);

    const claimed = await store.claim('worker-test', 10, '66666666-6666-4666-8666-666666666666');
    await store.markPublished(claimed[0]!, 'worker-test');
    await store.markFailed(claimed[0]!, 'worker-test', { retryAt: null, exhausted: true });

    expect(withOutboxWorkerTransaction).toHaveBeenCalledWith(
      { workerName: 'worker-test', correlationId: '66666666-6666-4666-8666-666666666666' },
      expect.any(Function),
    );
    expect(transaction.claimOutboxEvents).toHaveBeenCalledWith('worker-test', 10);
    expect(transaction.markOutboxPublished).toHaveBeenCalledWith(event.id, 'worker-test');
    expect(transaction.markOutboxFailed).toHaveBeenCalledWith(event.id, 'worker-test', null);
    expect(claimed[0]).toEqual(
      expect.objectContaining({ tenant: event.tenant, correlationId: event.correlationId }),
    );
  });

  it('publishes tenant-scoped envelopes and marks the claimed event as published', async () => {
    const store = storeFor([event]);
    const handler = vi.fn();
    const publisher = new DeterministicInProcessPublisher([handler]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new OutboxWorker(store, publisher, logger, {
      workerName: 'worker-test',
      correlationId: () => '66666666-6666-4666-8666-666666666666',
    });

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
      exhausted: 0,
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tenant: event.tenant }));
    expect(store.markPublished).toHaveBeenCalledWith(event, 'worker-test');
    expect(publisher.deliveries).toEqual([
      expect.objectContaining({
        id: event.id,
        tenant: event.tenant,
        correlationId: event.correlationId,
      }),
    ]);
  });

  it('marks failures with a bounded retry and never logs the event payload', async () => {
    const store = storeFor([event]);
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('broker: test-redacted-payload')),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new OutboxWorker(store, publisher, logger, {
      workerName: 'worker-test',
      clock: () => new Date('2026-07-30T10:00:00.000Z'),
      correlationId: () => '66666666-6666-4666-8666-666666666666',
    });

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
      exhausted: 0,
    });
    expect(store.markFailed).toHaveBeenCalledWith(event, 'worker-test', {
      retryAt: new Date('2026-07-30T10:00:01.000Z'),
      exhausted: false,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('test-redacted-payload');
  });

  it('keeps duplicate delivery deterministic within one worker process', async () => {
    const handler = vi.fn();
    const publisher = new DeterministicInProcessPublisher([handler]);
    await publisher.publish(event);
    await publisher.publish(event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(publisher.deliveries).toHaveLength(1);
  });
});
