import type { Logger } from 'pino';
import type { InProcessOutboxHandler, OutboxEvent } from '../outbox-publisher.js';
import { ProcessBimModelJob } from './process-bim-model.job.js';
import type { VinopsDatabase } from '@vinops/database';
import type { ObjectStorage } from '@vinops/file';

export function createBimEventHandlers(
  database?: VinopsDatabase,
  storage?: ObjectStorage,
  logger?: Pick<Logger, 'info' | 'error'>,
): { handler: InProcessOutboxHandler } {
  const job = new ProcessBimModelJob(database, storage);

  const handler: InProcessOutboxHandler = async (event: Readonly<OutboxEvent>): Promise<void> => {
    if (event.eventType === 'bim_model.uploaded.v1' || event.eventType === 'bim.model.uploaded') {
      const payload = event.payload;
      const modelId =
        typeof payload['modelId'] === 'string' ? payload['modelId'] : event.aggregateId;
      const revisionId = typeof payload['revisionId'] === 'string' ? payload['revisionId'] : '';
      const sourceFileId =
        typeof payload['sourceFileId'] === 'string'
          ? payload['sourceFileId']
          : typeof payload['rawIfcFileId'] === 'string'
            ? payload['rawIfcFileId']
            : '';

      logger?.info({ eventId: event.id, modelId }, 'Processing uploaded BIM model');
      await job.process({
        modelId,
        revisionId,
        sourceFileId,
        organizationId: event.tenant.organizationId ?? undefined,
        projectId: event.tenant.projectId ?? undefined,
      });
    }
  };

  return { handler };
}
