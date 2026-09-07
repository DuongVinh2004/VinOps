import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VinopsDatabase } from '@vinops/database';
import { ClamAvScanner, S3ObjectStorage } from '@vinops/file';
import { FileProcessingWorker } from '../src/file-processing-worker.js';

const databaseUrl = process.env.VINOPS_TEST_DATABASE_URL;
const s3Endpoint = process.env.VINOPS_TEST_S3_ENDPOINT;
const s3Bucket = process.env.VINOPS_TEST_S3_BUCKET;
const s3AccessKey = process.env.VINOPS_TEST_S3_ACCESS_KEY_ID;
const s3SecretKey = process.env.VINOPS_TEST_S3_SECRET_ACCESS_KEY;
const clamAvHost = process.env.VINOPS_TEST_CLAMAV_HOST;
const clamAvPort = Number(process.env.VINOPS_TEST_CLAMAV_PORT ?? '0');
const runtimeConfigured =
  databaseUrl !== undefined &&
  s3Endpoint !== undefined &&
  s3Bucket !== undefined &&
  s3AccessKey !== undefined &&
  s3SecretKey !== undefined &&
  clamAvHost !== undefined &&
  Number.isInteger(clamAvPort) &&
  clamAvPort > 0;
const describeRuntime = runtimeConfigured ? describe : describe.skip;

let owner: Pool | undefined;
let workerDatabase: VinopsDatabase | undefined;

beforeAll(() => {
  if (!runtimeConfigured || databaseUrl === undefined) return;
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//u, '');
  if (!/^(vinops_mega002_i[12]_test\d*|vinops_chat1_test)$/u.test(databaseName)) {
    throw new Error('Worker runtime test requires an isolated VIN-MEGA-002 or chat1 database.');
  }
  owner = new Pool({
    connectionString: databaseUrl,
    application_name: 'vinops-file-worker-test-owner',
  });
  workerDatabase = new VinopsDatabase({
    connectionString: databaseUrl,
    applicationName: 'vinops-file-worker-test',
    runtimeRole: 'vinops_worker',
  });
});

afterAll(async () => {
  await workerDatabase?.close();
  await owner?.end();
});

async function fixture(
  bytes: Uint8Array,
  mediaType: string,
  jobType: 'validate_scan_preview' | 'reconcile' = 'validate_scan_preview',
): Promise<{ fileId: string; jobId: string }> {
  if (owner === undefined) throw new Error('Owner database unavailable.');
  const userId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const fileId = randomUUID();
  const jobId = randomUUID();
  const projectCode = `W${projectId.replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  const key = `quarantine/${fileId}/original`;
  const storage = new S3ObjectStorage({
    endpoint: s3Endpoint as string,
    region: 'us-east-1',
    bucket: s3Bucket as string,
    accessKeyId: s3AccessKey as string,
    secretAccessKey: s3SecretKey as string,
  });
  await storage.putObject(key, bytes, mediaType);
  await owner.query(
    `INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
     VALUES ($1::uuid, $2, 'Synthetic Worker Owner', 'hash')`,
    [userId, `${userId}@vinops.test`],
  );
  await owner.query(
    `INSERT INTO vinops.organizations (id, code, name, created_by)
     VALUES ($1::uuid, $2, 'Synthetic Worker Tenant', $3::uuid)`,
    [organizationId, projectCode, userId],
  );
  await owner.query(
    `INSERT INTO vinops.projects (id, organization_id, code, name, timezone, status, created_by)
     VALUES ($1::uuid, $2::uuid, 'FILE', 'Synthetic Worker Project', 'Asia/Bangkok', 'Active', $3::uuid)`,
    [projectId, organizationId, userId],
  );
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await owner.query(
    `INSERT INTO vinops.file_objects (
      id, organization_id, project_id, storage_provider, storage_bucket,
      quarantine_object_key, original_filename, declared_size_bytes,
      declared_media_type, declared_sha256, status, created_by
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, 's3', $4, $5, 'runtime.pdf', $6, $7, $8, 'Validating', $9::uuid)`,
    [
      fileId,
      organizationId,
      projectId,
      s3Bucket,
      key,
      bytes.byteLength,
      mediaType,
      checksum,
      userId,
    ],
  );
  await owner.query(
    `INSERT INTO vinops.file_processing_jobs (
      id, organization_id, project_id, file_id, job_type
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`,
    [jobId, organizationId, projectId, fileId, jobType],
  );
  return { fileId, jobId };
}

function processor(): FileProcessingWorker {
  if (workerDatabase === undefined) throw new Error('Worker database unavailable.');
  const storage = new S3ObjectStorage({
    endpoint: s3Endpoint as string,
    region: 'us-east-1',
    bucket: s3Bucket as string,
    accessKeyId: s3AccessKey as string,
    secretAccessKey: s3SecretKey as string,
  });
  const scanner = new ClamAvScanner({
    host: clamAvHost as string,
    port: clamAvPort,
    signatureVersion: 'local-runtime',
  });
  const logger = { info: () => undefined, error: () => undefined } as unknown as Pick<
    Logger,
    'info' | 'error'
  >;
  return new FileProcessingWorker(
    workerDatabase,
    storage,
    scanner,
    logger,
    'vinops-mega002-i1-test-worker',
  );
}

describeRuntime('file processing worker with PostgreSQL, MinIO, and ClamAV', () => {
  it('promotes a clean PDF, records the scan/derivative, and emits file.available.v1 once', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% synthetic clean worker file\n%%EOF\n', 'utf8');
    const item = await fixture(bytes, 'application/pdf');
    await expect(processor().runOnce(1)).resolves.toMatchObject({ claimed: 1, available: 1 });
    const file = await owner?.query<{ status: string; actual_sha256: string }>(
      'SELECT status, actual_sha256 FROM vinops.file_objects WHERE id = $1::uuid',
      [item.fileId],
    );
    expect(file?.rows[0]).toMatchObject({
      status: 'Available',
      actual_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(
      Number(
        (
          await owner?.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM vinops.file_derivatives
              WHERE file_id = $1::uuid AND kind = 'preview'`,
            [item.fileId],
          )
        )?.rows[0]?.count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await owner?.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM vinops.outbox_events
              WHERE aggregate_id = $1::uuid AND event_type = 'file.available.v1'`,
            [item.fileId],
          )
        )?.rows[0]?.count,
      ),
    ).toBe(1);
    await expect(processor().runOnce(1)).resolves.toMatchObject({ claimed: 0 });
  });

  it('rejects a runtime-injected malware signature without promoting or previewing it', async () => {
    const injected = process.env.VINOPS_MALWARE_TEST_B64;
    if (injected === undefined)
      throw new Error('VINOPS_MALWARE_TEST_B64 is required for worker malware proof.');
    const bytes = Buffer.from(injected, 'base64');
    const item = await fixture(bytes, 'application/x-vinops-malware-test');
    await expect(processor().runOnce(1)).resolves.toMatchObject({ claimed: 1, rejected: 1 });
    const file = await owner?.query<{ status: string; failure_code: string }>(
      'SELECT status, failure_code FROM vinops.file_objects WHERE id = $1::uuid',
      [item.fileId],
    );
    expect(file?.rows[0]).toEqual({ status: 'Rejected', failure_code: 'MALWARE_DETECTED' });
    expect(
      Number(
        (
          await owner?.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM vinops.file_derivatives WHERE file_id = $1::uuid',
            [item.fileId],
          )
        )?.rows[0]?.count,
      ),
    ).toBe(0);
  });

  it('reconciles a stuck quarantine job without promoting the object', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% synthetic reconciliation file\n%%EOF\n', 'utf8');
    const item = await fixture(bytes, 'application/pdf', 'reconcile');
    await expect(processor().runOnce(1)).resolves.toMatchObject({ claimed: 1, reconciled: 1 });
    const file = await owner?.query<{ status: string; failure_code: string }>(
      'SELECT status, failure_code FROM vinops.file_objects WHERE id = $1::uuid',
      [item.fileId],
    );
    expect(file?.rows[0]).toEqual({
      status: 'Quarantined',
      failure_code: 'RECONCILIATION_REQUIRED',
    });
    const job = await owner?.query<{ status: string }>(
      'SELECT status FROM vinops.file_processing_jobs WHERE id = $1::uuid',
      [item.jobId],
    );
    expect(job?.rows[0]?.status).toBe('Completed');
  });
});
