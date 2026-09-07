import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VinopsDatabase } from '@vinops/database';
import { runMigrations } from '../../../packages/database/src/migrate.js';
import { ClamAvScanner, S3ObjectStorage } from '@vinops/file';
import { FileProcessingWorker } from '../src/file-processing-worker.js';
import { QuarantineCleanupWorker } from '../src/quarantine-cleanup-worker.js';
import { OutboxWorker } from '../src/outbox-worker.js';
import { PostgreSqlOutboxStore } from '../src/postgres-outbox-store.js';
import { DeterministicInProcessPublisher } from '../src/outbox-publisher.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_TEST_DATABASE_URL ?? `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat2_test`;

const workerUser = 'vinops_worker_user';
const workerPass = 'fixture-vinops-password';
const workerAuth = `${workerUser}:${workerPass}`;
const workerDbUrl = `postgresql://${workerAuth}@127.0.0.1:5432/vinops_chat2_test`;

const s3Endpoint = process.env.VINOPS_TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const s3Bucket = process.env.VINOPS_TEST_S3_BUCKET ?? 'vinops-files';
const s3AccessKey = process.env.VINOPS_TEST_S3_ACCESS_KEY_ID ?? 'minioadmin';
const s3SecretKey = process.env.VINOPS_TEST_S3_SECRET_ACCESS_KEY ?? 'minioadmin';
const clamAvHost = process.env.VINOPS_TEST_CLAMAV_HOST ?? '127.0.0.1';
const clamAvPort = Number(process.env.VINOPS_TEST_CLAMAV_PORT ?? '3310');

let pool: Pool;
let workerDb: VinopsDatabase;
let storage: S3ObjectStorage;
let scanner: ClamAvScanner;

const ids = {
  // Tenant A (Main Developer)
  tenantA: randomUUID(),
  userAdminA: randomUUID(),
  userContractor1: randomUUID(),
  userContractor2: randomUUID(),
  userSupervisor: randomUUID(),
  projectA: randomUUID(),
  partnerContractor1: randomUUID(),
  partnerContractor2: randomUUID(),
  partnerConsultant: randomUUID(),

  // Tenant B (Competitor Developer)
  tenantB: randomUUID(),
  userAdminB: randomUUID(),
  userContractorB: randomUUID(),
  projectB: randomUUID(),
} as const;

async function asApp<T>(userId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE vinops_app');
    await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
      userId,
      randomUUID(),
    ]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('ER Gate B: Security, RLS BOLA/IDOR, Outbox Crash Recovery & File Pipeline Compensation', () => {
  beforeAll(async () => {
    await runMigrations(connectionString);
    pool = new Pool({ connectionString, application_name: 'vinops-gate-b-security', max: 4 });
    workerDb = new VinopsDatabase({
      connectionString: workerDbUrl,
      applicationName: 'vinops-gate-b-worker',
      runtimeRole: 'vinops_worker',
    });
    storage = new S3ObjectStorage({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      bucket: s3Bucket,
      accessKeyId: s3AccessKey,
      secretAccessKey: s3SecretKey,
    });
    scanner = new ClamAvScanner({ host: clamAvHost, port: clamAvPort });

    // Seed baseline multi-tenant and multi-partner hierarchy
    const runHex = randomUUID().replace(/-/g, '').slice(0, 8);
    const runId = runHex.toUpperCase();
    const runLower = runHex.toLowerCase();
    await pool.query(`
      INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
      VALUES
        ('${ids.userAdminA}', 'admin-a-${runLower}@gateb.test', 'Admin A', 'hash'),
        ('${ids.userContractor1}', 'cont1-${runLower}@gateb.test', 'Contractor 1 PM', 'hash'),
        ('${ids.userContractor2}', 'cont2-${runLower}@gateb.test', 'Contractor 2 PM', 'hash'),
        ('${ids.userSupervisor}', 'tvgs-${runLower}@gateb.test', 'Supervisor TVGS', 'hash'),
        ('${ids.userAdminB}', 'admin-b-${runLower}@gateb.test', 'Admin B', 'hash'),
        ('${ids.userContractorB}', 'cont-b-${runLower}@gateb.test', 'Contractor B PM', 'hash')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organizations (id, code, name, created_by)
      VALUES
        ('${ids.tenantA}', 'TA_${runId}', 'Tenant A Developer', '${ids.userAdminA}'),
        ('${ids.tenantB}', 'TB_${runId}', 'Tenant B Developer', '${ids.userAdminB}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
      VALUES
        ('${randomUUID()}', '${ids.tenantA}', '${ids.userAdminA}', ARRAY['organization_owner'], 'Active'),
        ('${randomUUID()}', '${ids.tenantA}', '${ids.userContractor1}', ARRAY['organization_member'], 'Active'),
        ('${randomUUID()}', '${ids.tenantA}', '${ids.userContractor2}', ARRAY['organization_member'], 'Active'),
        ('${randomUUID()}', '${ids.tenantA}', '${ids.userSupervisor}', ARRAY['organization_member'], 'Active'),
        ('${randomUUID()}', '${ids.tenantB}', '${ids.userAdminB}', ARRAY['organization_owner'], 'Active'),
        ('${randomUUID()}', '${ids.tenantB}', '${ids.userContractorB}', ARRAY['organization_member'], 'Active')
      ON CONFLICT (organization_id, user_id) DO NOTHING;

      INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
      VALUES
        ('${ids.projectA}', '${ids.tenantA}', 'PJA_${runId}', 'Gate B Project A', 'Asia/Ho_Chi_Minh', '${ids.userAdminA}'),
        ('${ids.projectB}', '${ids.tenantB}', 'PJB_${runId}', 'Gate B Project B', 'Asia/Ho_Chi_Minh', '${ids.userAdminB}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.partner_organizations (id, organization_id, project_id, code, name, created_by)
      VALUES
        ('${ids.partnerContractor1}', '${ids.tenantA}', '${ids.projectA}', 'PC1_${runId}', 'Partner Contractor 1', '${ids.userAdminA}'),
        ('${ids.partnerContractor2}', '${ids.tenantA}', '${ids.projectA}', 'PC2_${runId}', 'Partner Contractor 2', '${ids.userAdminA}'),
        ('${ids.partnerConsultant}', '${ids.tenantA}', '${ids.projectA}', 'PCO_${runId}', 'Partner Consultant', '${ids.userAdminA}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, partner_organization_id, status, valid_from)
      VALUES
        ('${randomUUID()}', '${ids.tenantA}', '${ids.projectA}', '${ids.userAdminA}', ARRAY['project_admin'], NULL, 'Active', now()),
        ('${randomUUID()}', '${ids.tenantA}', '${ids.projectA}', '${ids.userSupervisor}', ARRAY['consultant_lead'], NULL, 'Active', now()),
        ('${randomUUID()}', '${ids.tenantA}', '${ids.projectA}', '${ids.userContractor1}', ARRAY['contractor'], '${ids.partnerContractor1}', 'Active', now()),
        ('${randomUUID()}', '${ids.tenantA}', '${ids.projectA}', '${ids.userContractor2}', ARRAY['contractor'], '${ids.partnerContractor2}', 'Active', now()),
        ('${randomUUID()}', '${ids.tenantB}', '${ids.projectB}', '${ids.userAdminB}', ARRAY['project_admin'], NULL, 'Active', now()),
        ('${randomUUID()}', '${ids.tenantB}', '${ids.projectB}', '${ids.userContractorB}', ARRAY['contractor'], NULL, 'Active', now())
      ON CONFLICT (project_id, user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await workerDb?.close();
    await pool?.end();
  });

  describe('1. Negative RLS Tests: BOLA / IDOR Protection', () => {
    it('Cross-tenant isolation: Tenant A user cannot read or update Tenant B project and documents', async () => {
      const docBId = randomUUID();
      await pool.query(`
        INSERT INTO vinops.documents (id, organization_id, project_id, numbering_context, code, title, document_type, created_by)
        VALUES ('${docBId}', '${ids.tenantB}', '${ids.projectB}', 'default', 'DWG-B-001', 'Confidential Tenant B Drawing', 'drawing', '${ids.userAdminB}')
      `);

      await asApp(ids.userAdminA, async (client) => {
        // SELECT project: Tenant B project must not appear
        const projects = await client.query<{ id: string }>(
          'SELECT id FROM vinops.projects WHERE id = $1::uuid',
          [ids.projectB],
        );
        expect(projects.rows).toHaveLength(0);

        // SELECT document: Tenant B document must not appear
        const docs = await client.query<{ id: string }>(
          'SELECT id FROM vinops.documents WHERE id = $1::uuid',
          [docBId],
        );
        expect(docs.rows).toHaveLength(0);

        // Direct IDOR UPDATE: must affect 0 rows
        const updateAttempt = await client.query(
          "UPDATE vinops.documents SET title = 'HACKED' WHERE id = $1::uuid",
          [docBId],
        );
        expect(updateAttempt.rowCount).toBe(0);

        const projectUpdateAttempt = await client.query(
          "UPDATE vinops.projects SET name = 'HACKED' WHERE id = $1::uuid",
          [ids.projectB],
        );
        expect(projectUpdateAttempt.rowCount).toBe(0);
      });
    });

    it('Partner/Contractor isolation: Contractor 2 cannot access Contractor 1 private issues and submittals, but Supervisor can', async () => {
      const issue1Id = randomUUID();
      const submittal1Id = randomUUID();

      // Seed Contractor 1 exclusive issue and submittal
      await pool.query(`
        INSERT INTO vinops.field_issues (
          id, organization_id, project_id, code, title, description, category,
          status, severity, contractor_organization_id, created_by
        ) VALUES (
          '${issue1Id}', '${ids.tenantA}', '${ids.projectA}', 'ISS-GB-01', 'Contractor 1 Foundation Defect', 'Confidential weld defect',
          'quality', 'Open', 'high', '${ids.partnerContractor1}', '${ids.userContractor1}'
        );

        INSERT INTO vinops.submittals (
          id, organization_id, project_id, code, title, submittal_type,
          status, maker_partner_organization_id, consultant_partner_organization_id, created_by
        ) VALUES (
          '${submittal1Id}', '${ids.tenantA}', '${ids.projectA}', 'SUB-GB-01', 'Contractor 1 Concrete Mix Design', 'material_sample',
          'Draft', '${ids.partnerContractor1}', '${ids.partnerConsultant}', '${ids.userContractor1}'
        );
      `);

      // 1. Contractor 2 attempts BOLA/IDOR on Contractor 1's issue and submittal
      await asApp(ids.userContractor2, async (client) => {
        // Cannot read issue
        const issueQuery = await client.query(
          'SELECT id FROM vinops.field_issues WHERE id = $1::uuid',
          [issue1Id],
        );
        expect(issueQuery.rows).toHaveLength(0);

        // Cannot update issue
        const issueUpdate = await client.query(
          "UPDATE vinops.field_issues SET description = 'Tampered' WHERE id = $1::uuid",
          [issue1Id],
        );
        expect(issueUpdate.rowCount).toBe(0);

        // Cannot read submittal
        const submittalQuery = await client.query(
          'SELECT id FROM vinops.submittals WHERE id = $1::uuid',
          [submittal1Id],
        );
        expect(submittalQuery.rows).toHaveLength(0);

        // Cannot update submittal
        const submittalUpdate = await client.query(
          "UPDATE vinops.submittals SET title = 'Tampered' WHERE id = $1::uuid",
          [submittal1Id],
        );
        expect(submittalUpdate.rowCount).toBe(0);
      });

      // 2. Supervisor CAN read both records because is_project_supervisor evaluates true
      await asApp(ids.userSupervisor, async (client) => {
        const supIssue = await client.query<{ title: string }>(
          'SELECT title FROM vinops.field_issues WHERE id = $1::uuid',
          [issue1Id],
        );
        expect(supIssue.rows).toHaveLength(1);
        expect(supIssue.rows[0]?.title).toBe('Contractor 1 Foundation Defect');

        const supSub = await client.query<{ title: string }>(
          'SELECT title FROM vinops.submittals WHERE id = $1::uuid',
          [submittal1Id],
        );
        expect(supSub.rows).toHaveLength(1);
        expect(supSub.rows[0]?.title).toBe('Contractor 1 Concrete Mix Design');
      });
    });
  });

  describe('2. Outbox Fault-Injection & Idempotency Key Crash Recovery', () => {
    it('recovers from worker crash during event dispatch, retries with backoff, and ensures idempotent delivery', async () => {
      // Shift existing pending events to the future so our test event is prioritized
      await pool.query(
        "UPDATE vinops.outbox_events SET available_at = now() + interval '1 day' WHERE status IN ('Pending', 'Failed')",
      );
      const eventId = randomUUID();
      await pool.query(`
        INSERT INTO vinops.outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload, status, available_at
        ) VALUES (
          '${eventId}', 'quality_acceptance', '${randomUUID()}', 'inspection.accepted.v1',
          jsonb_build_object('code', 'INSP-GB-01'), 'Pending', now() - interval '1 minute'
        )
      `);

      const store = new PostgreSqlOutboxStore(workerDb);
      let dispatchCount = 0;
      const handler = vi.fn(async () => {
        dispatchCount += 1;
        if (dispatchCount === 1) {
          throw new Error('Simulated network broker crash mid-flight');
        }
        await Promise.resolve();
      });
      const publisher = new DeterministicInProcessPublisher([handler]);
      const logger = { info: vi.fn(), error: vi.fn() };
      const worker = new OutboxWorker(store, publisher, logger, {
        workerName: 'gate-b-retry-worker',
        clock: () => new Date(),
        claimLimit: 1,
      });

      // Pass 1: Crashes on dispatch -> Failed, scheduled for retry
      const report1 = await worker.runOnce();
      expect(report1.claimed).toBe(1);
      expect(report1.failed).toBe(1);
      expect(report1.published).toBe(0);

      const failedState = await pool.query<{ status: string; publish_attempts: number }>(
        'SELECT status, publish_attempts FROM vinops.outbox_events WHERE id = $1::uuid',
        [eventId],
      );
      expect(failedState.rows[0]?.status).toBe('Pending');
      expect(failedState.rows[0]?.publish_attempts).toBe(1);

      // Fast-forward availability for retry
      await pool.query('UPDATE vinops.outbox_events SET available_at = now() WHERE id = $1::uuid', [
        eventId,
      ]);

      // Pass 2: Retry succeeds
      const report2 = await worker.runOnce();
      expect(report2.claimed).toBe(1);
      expect(report2.published).toBe(1);
      expect(report2.failed).toBe(0);

      // State is Published
      const publishedState = await pool.query<{ status: string; publish_attempts: number }>(
        'SELECT status, publish_attempts FROM vinops.outbox_events WHERE id = $1::uuid',
        [eventId],
      );
      expect(publishedState.rows[0]?.status).toBe('Published');
      expect(publishedState.rows[0]?.publish_attempts).toBe(2);

      // Publisher deduplicates all subsequent attempts: deliveries length is exactly 1
      expect(publisher.deliveries).toHaveLength(1);
    });

    it('idempotency key transaction crash does not leave unrecoverable pending locks', async () => {
      const idempotencyKey = `crash-key-${randomUUID()}`;
      const operation = 'project.issue.create';

      // 1. First attempt starts transaction, inserts idempotency key, but crashes before commit (DB rollback)
      await expect(
        asApp(ids.userContractor1, async (client) => {
          await client.query(
            `
            INSERT INTO vinops.idempotency_keys (id, actor_user_id, operation, idempotency_key, payload_hash)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5)
          `,
            [
              randomUUID(),
              ids.userContractor1,
              operation,
              idempotencyKey,
              createHash('sha256').update('{}').digest('hex'),
            ],
          );

          // Crash simulation
          throw new Error('SIMULATED_DB_CRASH_MID_TRANSACTION');
        }),
      ).rejects.toThrow('SIMULATED_DB_CRASH_MID_TRANSACTION');

      // Verify the idempotency key was rolled back atomically and does not leave a stuck lock
      const keyCheck = await pool.query(
        'SELECT status FROM vinops.idempotency_keys WHERE actor_user_id = $1::uuid AND operation = $2 AND idempotency_key = $3',
        [ids.userContractor1, operation, idempotencyKey],
      );
      expect(keyCheck.rows).toHaveLength(0);

      // 2. Client retries the request -> succeeds and marks Completed
      const completedResult = await asApp(ids.userContractor1, async (client) => {
        const id = randomUUID();
        await client.query(
          `
          INSERT INTO vinops.idempotency_keys (id, actor_user_id, operation, idempotency_key, payload_hash, status, response_code, response_body)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'Completed', 200, '{"success":true}'::jsonb)
        `,
          [
            id,
            ids.userContractor1,
            operation,
            idempotencyKey,
            createHash('sha256').update('{}').digest('hex'),
          ],
        );
        return { success: true };
      });
      expect(completedResult).toEqual({ success: true });

      // 3. Repeated request returns existing completed response
      await asApp(ids.userContractor1, async (client) => {
        const cached = await client.query<{ status: string; response_body: { success: boolean } }>(
          'SELECT status, response_body FROM vinops.idempotency_keys WHERE actor_user_id = $1::uuid AND operation = $2 AND idempotency_key = $3',
          [ids.userContractor1, operation, idempotencyKey],
        );
        expect(cached.rows[0]?.status).toBe('Completed');
        expect(cached.rows[0]?.response_body).toEqual({ success: true });
      });
    });
  });

  describe('3. File Pipeline Compensation: Malware Rejection & MinIO Orphan Cleanup', () => {
    it('detects malware signature with ClamAV, rejects file, and sweeps garbage from MinIO via QuarantineCleanupWorker', async () => {
      const fileId = randomUUID();
      const jobId = randomUUID();
      const quarantineKey = `quarantine/${fileId}/original`;
      const eicarBase64 =
        process.env.VINOPS_MALWARE_TEST_B64 ??
        'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=';
      const malwareBytes = Buffer.from(eicarBase64, 'base64');
      const sha256 = createHash('sha256').update(malwareBytes).digest('hex');

      // 1. Upload malware payload to MinIO quarantine
      await storage.putObject(quarantineKey, malwareBytes, 'application/x-vinops-malware-test');
      const uploadedHead = await storage.headObject(quarantineKey);
      expect(uploadedHead.sizeBytes).toBe(malwareBytes.length);

      // 2. Insert DB records in Quarantined state
      await pool.query(
        `INSERT INTO vinops.file_objects (
          id, organization_id, project_id, storage_provider, storage_bucket,
          quarantine_object_key, original_filename, declared_size_bytes, actual_size_bytes,
          declared_media_type, declared_sha256, status, created_by, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 's3', 'vinops-files',
          $4, 'threat-document.bin', $5, $5,
          'application/x-vinops-malware-test', $6, 'Quarantined', $7::uuid, now() - interval '2 hours'
        )`,
        [
          fileId,
          ids.tenantA,
          ids.projectA,
          quarantineKey,
          malwareBytes.length,
          sha256,
          ids.userContractor1,
        ],
      );

      await pool.query(
        `INSERT INTO vinops.file_processing_jobs (
          id, file_id, organization_id, project_id, job_type, status, attempts
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'validate_scan_preview', 'Pending', 0
        )`,
        [jobId, fileId, ids.tenantA, ids.projectA],
      );

      // 3. Run FileProcessingWorker -> ClamAV detects malware, marks status Rejected / MALWARE_DETECTED
      const workerLogger = { info: vi.fn(), error: vi.fn() };
      const processor = new FileProcessingWorker(
        workerDb,
        storage,
        scanner,
        workerLogger,
        'gate-b-file-worker',
      );
      const processReport = await processor.runOnce(1);
      expect(processReport.claimed).toBe(1);
      expect(processReport.rejected).toBe(1);
      expect(processReport.available).toBe(0);

      const rejectedDb = await pool.query<{ status: string; failure_code: string }>(
        'SELECT status, failure_code FROM vinops.file_objects WHERE id = $1::uuid',
        [fileId],
      );
      expect(rejectedDb.rows[0]).toEqual({ status: 'Rejected', failure_code: 'MALWARE_DETECTED' });

      // Ensure no available object was created in MinIO
      await expect(storage.headObject(`available/${fileId}/original`)).rejects.toThrow();

      // 4. Run QuarantineCleanupWorker -> sweeps Rejected file, purges from MinIO and marks Purged in DB
      const cleanupLogger = { info: vi.fn(), error: vi.fn() };
      const cleanupWorker = new QuarantineCleanupWorker(
        workerDb,
        storage,
        cleanupLogger,
        'gate-b-cleanup-worker',
      );
      const cleanupReport = await cleanupWorker.runOnce(1); // cutoff 1 hour ago (file created 2h ago)
      expect(cleanupReport.purged).toBeGreaterThanOrEqual(1);

      // Verify MinIO: malware object was permanently purged
      await expect(storage.headObject(quarantineKey)).rejects.toThrow();

      // Verify DB: file status transitioned to Purged
      const purgedDb = await pool.query<{ status: string; failure_code: string }>(
        'SELECT status, failure_code FROM vinops.file_objects WHERE id = $1::uuid',
        [fileId],
      );
      expect(purgedDb.rows[0]?.status).toBe('Purged');
    });

    it('cleans up abandoned upload sessions and purges uncommitted orphan objects', async () => {
      const orphanFileId = randomUUID();
      const sessionId = randomUUID();
      const orphanKey = `quarantine/${orphanFileId}/orphan.pdf`;
      const dummyBytes = Buffer.from('%PDF-1.7 orphan payload', 'utf8');
      const orphanSha = createHash('sha256').update(dummyBytes).digest('hex');
      const credHash = createHash('sha256').update(randomUUID()).digest('hex');

      // 1. Put orphan object into MinIO
      await storage.putObject(orphanKey, dummyBytes, 'application/pdf');

      // 2. Insert parent file_object in Quarantined state (created 2h ago)
      await pool.query(
        `INSERT INTO vinops.file_objects (
          id, organization_id, project_id, storage_provider, storage_bucket,
          quarantine_object_key, original_filename, declared_size_bytes, actual_size_bytes,
          declared_media_type, declared_sha256, status, created_by, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 's3', 'vinops-files',
          $4, 'orphan.pdf', $5, $5,
          'application/pdf', $6, 'Quarantined', $7::uuid, now() - interval '2 hours'
        )`,
        [
          orphanFileId,
          ids.tenantA,
          ids.projectA,
          orphanKey,
          dummyBytes.length,
          orphanSha,
          ids.userContractor1,
        ],
      );

      // 3. Insert expired upload session in DB (created 2h ago, expired 30m ago)
      await pool.query(
        `INSERT INTO vinops.upload_sessions (
          id, organization_id, project_id, file_id, storage_upload_id,
          credential_hash, status, part_size_bytes, expires_at, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'upload-orphan-1',
          $5, 'Open', 5242880, now() - interval '30 minutes', now() - interval '2 hours'
        )`,
        [sessionId, ids.tenantA, ids.projectA, orphanFileId, credHash],
      );

      // 4. Trigger cleanup with maxAgeHours = 1 (cutoff 1h ago)
      const cleanupLogger = { info: vi.fn(), error: vi.fn() };
      const cleanupWorker = new QuarantineCleanupWorker(
        workerDb,
        storage,
        cleanupLogger,
        'gate-b-orphan-cleanup',
      );
      const report = await cleanupWorker.runOnce(1);
      expect(report.purged).toBeGreaterThanOrEqual(1);

      // Verify upload session was marked Expired
      const sessionDb = await pool.query<{ status: string }>(
        'SELECT status FROM vinops.upload_sessions WHERE id = $1::uuid',
        [sessionId],
      );
      expect(sessionDb.rows[0]?.status).toBe('Expired');

      // Verify orphan file was purged from MinIO
      await expect(storage.headObject(orphanKey)).rejects.toThrow();

      // Verify DB file status is Purged
      const fileDb = await pool.query<{ status: string }>(
        'SELECT status FROM vinops.file_objects WHERE id = $1::uuid',
        [orphanFileId],
      );
      expect(fileDb.rows[0]?.status).toBe('Purged');
    });
  });
});
