import type { Logger } from 'pino';
import type { InProcessOutboxHandler, OutboxEvent } from './outbox-publisher.js';

export type DocumentEventMetrics = {
  publishedCount: number;
  submittedCount: number;
  unhandledCount: number;
};

export function createDocumentEventHandlers(
  logger: Pick<Logger, 'info' | 'error'>,
  metrics: DocumentEventMetrics = { publishedCount: 0, submittedCount: 0, unhandledCount: 0 },
): { handler: InProcessOutboxHandler; metrics: DocumentEventMetrics } {
  const handler: InProcessOutboxHandler = (event: Readonly<OutboxEvent>): Promise<void> => {
    if (event.eventType === 'revision.published.v1' || event.eventType === 'document.published') {
      metrics.publishedCount += 1;
      logger.info(
        {
          event_id: event.id,
          event_type: event.eventType,
          aggregate_id: event.aggregateId,
          revision_id: event.payload['revision_id'],
          document_id: event.payload['document_id'],
        },
        'document revision published event processed',
      );
      return Promise.resolve();
    }

    if (
      event.eventType === 'revision.submit_review.v1' ||
      event.eventType === 'revision.submitted'
    ) {
      metrics.submittedCount += 1;
      logger.info(
        {
          event_id: event.id,
          event_type: event.eventType,
          aggregate_id: event.aggregateId,
          revision_id: event.payload['revision_id'],
          document_id: event.payload['document_id'],
        },
        'revision submitted for review event processed',
      );
      return Promise.resolve();
    }

    metrics.unhandledCount += 1;
    return Promise.resolve();
  };

  return { handler, metrics };
}
