import type { Logger } from 'pino';
import type { VinopsDatabase } from '@vinops/database';
import type { ObjectStorage } from '@vinops/file';

export type QuarantineCleanupRunReport = {
  swept: number;
  purged: number;
  errors: number;
};

export class QuarantineCleanupWorker {
  constructor(
    private readonly database: VinopsDatabase,
    private readonly storage: ObjectStorage,
    private readonly logger: Pick<Logger, 'info' | 'error'>,
    private readonly workerName: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(maxAgeHours = 24): Promise<QuarantineCleanupRunReport> {
    const cutoff = new Date(this.clock().getTime() - maxAgeHours * 60 * 60 * 1000);
    const report: QuarantineCleanupRunReport = {
      swept: 0,
      purged: 0,
      errors: 0,
    };

    try {
      const candidates = await this.database.withOutboxWorkerTransaction(
        { workerName: this.workerName },
        async (transaction) => {
          // Expire overdue upload sessions
          await transaction.cleanupExpiredUploadSessions(this.clock());

          // Find candidate files that have been in Quarantine or Rejected state past cutoff
          return transaction.claimExpiredQuarantineFiles(cutoff, 50);
        },
      );

      report.swept = candidates.length;

      for (const candidate of candidates) {
        try {
          // Delete from object storage
          await this.storage.deleteObject(candidate.quarantine_object_key).catch((err: unknown) => {
            this.logger.error(
              { file_id: candidate.id, key: candidate.quarantine_object_key, err },
              'Failed to delete quarantine object from storage; proceeding with DB purge',
            );
          });

          // Mark as Purged in DB
          await this.database.withOutboxWorkerTransaction(
            { workerName: this.workerName },
            async (transaction) => {
              await transaction.purgeQuarantineFile(candidate.id);
            },
          );

          report.purged += 1;
          this.logger.info(
            { file_id: candidate.id, key: candidate.quarantine_object_key },
            'Quarantine file purged successfully after 24h expiration',
          );
        } catch (error) {
          report.errors += 1;
          this.logger.error(
            { file_id: candidate.id, error },
            'Error purging quarantine file record',
          );
        }
      }
    } catch (error) {
      report.errors += 1;
      this.logger.error({ error }, 'Error in quarantine cleanup run');
    }

    return report;
  }
}
