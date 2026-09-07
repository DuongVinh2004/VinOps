import type { OutboxClaim, OutboxWorkerTransaction, VinopsDatabase } from '@vinops/database';
import type { OutboxEvent } from './outbox-publisher.js';
import type { OutboxWorkerStore } from './outbox-worker.js';
import type { RetrySchedule } from './outbox-retry.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function correlationIdFrom(payload: Record<string, unknown>, fallback: string): string {
  const candidate = payload.correlation_id;
  return typeof candidate === 'string' && UUID_PATTERN.test(candidate) ? candidate : fallback;
}

function claimToEvent(claim: OutboxClaim, fallbackCorrelationId: string): OutboxEvent {
  return {
    id: claim.id,
    aggregateType: claim.aggregate_type,
    aggregateId: claim.aggregate_id,
    eventType: claim.event_type,
    payload: claim.payload,
    publishAttempts: claim.publish_attempts,
    tenant: {
      organizationId: claim.organization_id,
      projectId: claim.project_id,
    },
    correlationId: correlationIdFrom(claim.payload, fallbackCorrelationId),
  };
}

/**
 * The database package intentionally exposes no generic worker query method.
 * This adapter can invoke only the fixed SECURITY DEFINER claim/mark functions
 * while connected as vinops_worker, so worker code cannot become an unscoped
 * tenant-data bypass.
 */
export class PostgreSqlOutboxStore implements OutboxWorkerStore {
  constructor(private readonly database: VinopsDatabase) {}

  async claim(
    workerName: string,
    limit: number,
    correlationId: string,
  ): Promise<readonly OutboxEvent[]> {
    return this.database.withOutboxWorkerTransaction(
      { workerName, correlationId },
      async (transaction: OutboxWorkerTransaction) => {
        const claims = await transaction.claimOutboxEvents(workerName, limit);
        return claims.map((claim) => claimToEvent(claim, correlationId));
      },
    );
  }

  async markPublished(event: OutboxEvent, workerName: string): Promise<void> {
    await this.withEventTransaction(event, workerName, (transaction) =>
      transaction.markOutboxPublished(event.id, workerName),
    );
  }

  async markFailed(event: OutboxEvent, workerName: string, retry: RetrySchedule): Promise<void> {
    await this.withEventTransaction(event, workerName, (transaction) =>
      transaction.markOutboxFailed(event.id, workerName, retry.retryAt),
    );
  }

  private async withEventTransaction(
    event: OutboxEvent,
    workerName: string,
    operation: (transaction: OutboxWorkerTransaction) => Promise<void>,
  ): Promise<void> {
    await this.database.withOutboxWorkerTransaction(
      { workerName, correlationId: event.correlationId },
      operation,
    );
  }
}
