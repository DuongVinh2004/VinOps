import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { OutboxEvent, OutboxPublisher } from './outbox-publisher.js';
import {
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  scheduleOutboxRetry,
  type RetrySchedule,
} from './outbox-retry.js';

export type OutboxWorkerStore = {
  claim: (
    workerName: string,
    limit: number,
    correlationId: string,
  ) => Promise<readonly OutboxEvent[]>;
  markPublished: (event: OutboxEvent, workerName: string) => Promise<void>;
  markFailed: (event: OutboxEvent, workerName: string, retry: RetrySchedule) => Promise<void>;
};

export type OutboxRunReport = {
  claimed: number;
  published: number;
  failed: number;
  exhausted: number;
};

export type OutboxWorkerOptions = {
  workerName: string;
  claimLimit?: number;
  maxAttempts?: number;
  clock?: () => Date;
  correlationId?: () => string;
};

function safeEventFields(event: OutboxEvent): Record<string, unknown> {
  return {
    event_id: event.id,
    event_type: event.eventType,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    organization_id: event.tenant.organizationId,
    project_id: event.tenant.projectId,
    publish_attempt: event.publishAttempts,
    correlation_id: event.correlationId,
  };
}

function errorKind(error: unknown): string {
  return error instanceof Error && error.name.length > 0 ? error.name : 'UNKNOWN_ERROR';
}

/** A single deterministic polling pass; scheduling is owned by WorkerLifecycle. */
export class OutboxWorker {
  private readonly workerName: string;
  private readonly claimLimit: number;
  private readonly maxAttempts: number;
  private readonly clock: () => Date;
  private readonly correlationId: () => string;

  constructor(
    private readonly store: OutboxWorkerStore,
    private readonly publisher: OutboxPublisher,
    private readonly logger: Pick<Logger, 'info' | 'error'>,
    options: OutboxWorkerOptions,
  ) {
    this.workerName = options.workerName;
    this.claimLimit = Math.max(1, Math.min(options.claimLimit ?? 25, 100));
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS);
    this.clock = options.clock ?? (() => new Date());
    this.correlationId = options.correlationId ?? randomUUID;
  }

  async runOnce(): Promise<OutboxRunReport> {
    const events = await this.store.claim(this.workerName, this.claimLimit, this.correlationId());
    const report: OutboxRunReport = {
      claimed: events.length,
      published: 0,
      failed: 0,
      exhausted: 0,
    };

    for (const event of events) {
      try {
        await this.publisher.publish(event);
        await this.store.markPublished(event, this.workerName);
        report.published += 1;
        this.logger.info(safeEventFields(event), 'outbox event published');
      } catch (error) {
        const retry = scheduleOutboxRetry(this.clock(), event.publishAttempts, this.maxAttempts);
        await this.store.markFailed(event, this.workerName, retry);
        report.failed += 1;
        if (retry.exhausted) {
          report.exhausted += 1;
        }
        this.logger.error(
          {
            ...safeEventFields(event),
            error_kind: errorKind(error),
            retry_at: retry.retryAt?.toISOString() ?? null,
            retry_exhausted: retry.exhausted,
          },
          'outbox event publication failed',
        );
      }
    }

    return report;
  }
}
