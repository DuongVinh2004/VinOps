import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { assertMagicBytes } from '@vinops/domain';
import type { FileProcessingClaim, VinopsDatabase } from '@vinops/database';
import type { MalwareScanner, ObjectStorage } from '@vinops/file';

export type FileProcessingRunReport = {
  claimed: number;
  available: number;
  rejected: number;
  reconciled: number;
  retried: number;
  failed: number;
};

function safeErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code.slice(0, 120);
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]{3,120}$/u.test(error.message)) {
    return error.message;
  }
  return 'FILE_PROCESSING_FAILED';
}

function retryAt(attempts: number, now: Date): Date | null {
  if (attempts >= 5) return null;
  return new Date(now.getTime() + Math.min(2 ** attempts, 300) * 1_000);
}

export class FileProcessingWorker {
  constructor(
    private readonly database: VinopsDatabase,
    private readonly storage: ObjectStorage,
    private readonly scanner: MalwareScanner,
    private readonly logger: Pick<Logger, 'info' | 'error'>,
    private readonly workerName: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(limit = 10): Promise<FileProcessingRunReport> {
    const claims = await this.database.withOutboxWorkerTransaction(
      { workerName: this.workerName },
      (transaction) => transaction.claimFileProcessingJobs(this.workerName, limit),
    );
    const report: FileProcessingRunReport = {
      claimed: claims.length,
      available: 0,
      rejected: 0,
      reconciled: 0,
      retried: 0,
      failed: 0,
    };
    for (const claim of claims) {
      await this.process(claim, report);
    }
    return report;
  }

  private async process(
    claim: FileProcessingClaim,
    report: FileProcessingRunReport,
  ): Promise<void> {
    try {
      if (claim.job_type === 'reconcile') {
        await this.reconcile(claim);
        report.reconciled += 1;
        return;
      }
      const bytes = await this.storage.getObject(claim.quarantine_object_key);
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      const actualSizeBytes = bytes.byteLength;
      let policyFailure: string | null = null;
      if (actualSizeBytes !== Number(claim.declared_size_bytes))
        policyFailure = 'UPLOAD_INCOMPLETE';
      if (actualSha256 !== claim.declared_sha256) policyFailure = 'CHECKSUM_MISMATCH';
      try {
        assertMagicBytes(claim.declared_media_type, bytes.subarray(0, 64));
      } catch (error) {
        policyFailure = safeErrorCode(error);
      }
      if (policyFailure !== null) {
        await this.completeRejected(
          claim,
          bytes,
          actualSha256,
          policyFailure,
          'policy',
          'not-run',
          null,
        );
        report.rejected += 1;
        return;
      }

      const scan = await this.scanner.scan(bytes);
      if (scan.outcome !== 'clean') {
        await this.completeRejected(
          claim,
          bytes,
          actualSha256,
          scan.outcome === 'infected' ? 'MALWARE_DETECTED' : scan.errorCode,
          scan.engine,
          scan.signatureVersion,
          scan.outcome === 'infected' ? scan.threatName : null,
        );
        report.rejected += 1;
        return;
      }

      const availableKey = `available/${claim.file_id}/original`;
      const previewKey = `derivatives/${claim.file_id}/preview`;
      await this.storage.copyObject(
        claim.quarantine_object_key,
        availableKey,
        claim.declared_media_type,
      );
      await this.storage.copyObject(
        claim.quarantine_object_key,
        previewKey,
        claim.declared_media_type,
      );
      await this.database.withOutboxWorkerTransaction(
        { workerName: this.workerName },
        (transaction) =>
          transaction.completeFileProcessing({
            jobId: claim.job_id,
            fileId: claim.file_id,
            workerName: this.workerName,
            result: 'Available',
            failureCode: null,
            actualSizeBytes,
            actualSha256,
            detectedMediaType: claim.declared_media_type,
            availableObjectKey: availableKey,
            scanEngine: scan.engine,
            signatureVersion: scan.signatureVersion,
            threatName: null,
            previewObjectKey: previewKey,
            previewMediaType: claim.declared_media_type,
            previewSizeBytes: actualSizeBytes,
            previewSha256: actualSha256,
          }),
      );
      report.available += 1;
      this.logger.info(
        { job_id: claim.job_id, file_id: claim.file_id, project_id: claim.project_id },
        'file processing completed',
      );
    } catch (error) {
      const next = retryAt(claim.attempts, this.clock());
      await this.database.withOutboxWorkerTransaction(
        { workerName: this.workerName },
        (transaction) =>
          transaction.retryFileProcessingJob(
            claim.job_id,
            this.workerName,
            safeErrorCode(error),
            next,
          ),
      );
      if (next === null) report.failed += 1;
      else report.retried += 1;
      this.logger.error(
        {
          job_id: claim.job_id,
          file_id: claim.file_id,
          project_id: claim.project_id,
          error_code: safeErrorCode(error),
          retry_at: next?.toISOString() ?? null,
        },
        'file processing failed',
      );
    }
  }

  private async reconcile(claim: FileProcessingClaim): Promise<void> {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.storage.getObject(claim.quarantine_object_key);
    } catch (error) {
      const code = safeErrorCode(error);
      if (code !== 'S3_HTTP_404' && code !== 'S3_OBJECT_NOT_FOUND') {
        throw error;
      }
    }
    const actualSizeBytes = bytes?.byteLength ?? null;
    const actualSha256 = bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
    const failureCode =
      bytes === null
        ? 'ORPHAN_OBJECT_MISSING'
        : actualSizeBytes !== Number(claim.declared_size_bytes) ||
            actualSha256 !== claim.declared_sha256
          ? 'CHECKSUM_MISMATCH'
          : 'RECONCILIATION_REQUIRED';
    await this.database.withOutboxWorkerTransaction(
      { workerName: this.workerName },
      (transaction) =>
        transaction.completeFileReconciliation({
          jobId: claim.job_id,
          fileId: claim.file_id,
          workerName: this.workerName,
          failureCode,
          actualSizeBytes,
          actualSha256,
        }),
    );
  }

  private async completeRejected(
    claim: FileProcessingClaim,
    bytes: Uint8Array,
    actualSha256: string,
    failureCode: string,
    scanEngine: string,
    signatureVersion: string,
    threatName: string | null,
  ): Promise<void> {
    await this.database.withOutboxWorkerTransaction(
      { workerName: this.workerName },
      (transaction) =>
        transaction.completeFileProcessing({
          jobId: claim.job_id,
          fileId: claim.file_id,
          workerName: this.workerName,
          result: failureCode === 'MALWARE_DETECTED' ? 'Rejected' : 'Quarantined',
          failureCode,
          actualSizeBytes: bytes.byteLength,
          actualSha256,
          detectedMediaType: claim.declared_media_type,
          availableObjectKey: null,
          scanEngine,
          signatureVersion,
          threatName,
          previewObjectKey: null,
          previewMediaType: null,
          previewSizeBytes: null,
          previewSha256: null,
        }),
    );
  }
}
