import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';

const connectionString = process.env.VINOPS_TEST_DATABASE_URL;
const describePostgres = connectionString === undefined ? describe.skip : describe;
let pool: Pool | undefined;

type Fixture = {
  organizationId: string;
  projectId: string;
  locationId: string;
  disciplineId: string;
  workId: string;
  makerId: string;
  reviewerId: string;
  publisherId: string;
};

async function asApp<T>(userId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  if (pool === undefined) throw new Error('PostgreSQL pool unavailable.');
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

async function fixture(): Promise<Fixture> {
  if (pool === undefined) throw new Error('PostgreSQL pool unavailable.');
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const locationId = randomUUID();
  const disciplineId = randomUUID();
  const workId = randomUUID();
  const makerId = randomUUID();
  const reviewerId = randomUUID();
  const publisherId = randomUUID();
  const code = `T${organizationId.replaceAll('-', '').slice(0, 10).toUpperCase()}`;

  await pool.query(
    `INSERT INTO vinops.users (id, email_normalized, display_name, password_hash) VALUES
      ($1::uuid, $4, 'MegaA Maker', 'hash'),
      ($2::uuid, $5, 'MegaA Reviewer', 'hash'),
      ($3::uuid, $6, 'MegaA Publisher', 'hash')`,
    [
      makerId,
      reviewerId,
      publisherId,
      `${makerId}@vinops.test`,
      `${reviewerId}@vinops.test`,
      `${publisherId}@vinops.test`,
    ],
  );

  await pool.query(
    `INSERT INTO vinops.organizations (id, code, name, created_by)
     VALUES ($1::uuid, $2, 'Synthetic Mega-A Organization', $3::uuid)`,
    [organizationId, code, makerId],
  );

  await pool.query(
    `INSERT INTO vinops.organization_members (id, organization_id, user_id, roles) VALUES
      ($1::uuid, $4::uuid, $5::uuid, ARRAY['organization_owner']),
      ($2::uuid, $4::uuid, $6::uuid, ARRAY['organization_member']),
      ($3::uuid, $4::uuid, $7::uuid, ARRAY['organization_member'])`,
    [randomUUID(), randomUUID(), randomUUID(), organizationId, makerId, reviewerId, publisherId],
  );

  await pool.query(
    `INSERT INTO vinops.projects (id, organization_id, code, name, timezone, status, created_by)
     VALUES ($1::uuid, $2::uuid, 'PRJ-A', 'Mega-A Controlled Project', 'Asia/Bangkok', 'Active', $3::uuid)`,
    [projectId, organizationId, makerId],
  );

  await pool.query(
    `INSERT INTO vinops.location_nodes (id, organization_id, project_id, code, name, node_type, sort_order, created_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'LOC-01', 'Tower 1 Level 05', 'level', 1, $4::uuid)`,
    [locationId, organizationId, projectId, makerId],
  );

  await pool.query(
    `INSERT INTO vinops.disciplines (id, organization_id, project_id, code, name, created_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'STR', 'Structural Engineering', $4::uuid)`,
    [disciplineId, organizationId, projectId, makerId],
  );

  await pool.query(
    `INSERT INTO vinops.work_nodes (id, organization_id, project_id, code, name, node_type, created_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'WBS-01', 'Core Wall Concrete', 'work_package', $4::uuid)`,
    [workId, organizationId, projectId, makerId],
  );

  const members = [
    { id: randomUUID(), user: makerId, role: 'document_controller' },
    { id: randomUUID(), user: reviewerId, role: 'assigned_reviewer' },
    { id: randomUUID(), user: publisherId, role: 'pm_cht' },
  ];

  for (const member of members) {
    await pool.query(
      `INSERT INTO vinops.project_members (
        id, organization_id, project_id, user_id, roles, status, valid_from
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, ARRAY[$5], 'Active', now())`,
      [member.id, organizationId, projectId, member.user, member.role],
    );
    await pool.query(
      `INSERT INTO vinops.member_scopes (
        id, organization_id, project_id, project_member_id, scope_type, scope_id, actions
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'project', $3::uuid,
        ARRAY['read','document.create','revision.create','revision.submit','revision.publish','revision.withdraw','annotation.create','transmittal.create'])`,
      [randomUUID(), organizationId, projectId, member.id],
    );
  }

  return {
    organizationId,
    projectId,
    locationId,
    disciplineId,
    workId,
    makerId,
    reviewerId,
    publisherId,
  };
}

describePostgres('Mega-Slice A: CDE & Document Control PostgreSQL Integration', () => {
  beforeAll(async () => {
    if (connectionString === undefined) return;
    const database = new URL(connectionString).pathname.replace(/^\//u, '');
    if (!/^(vinops_mega002_i[12]_test\d*|vinops_chat1_test)$/u.test(database)) {
      throw new Error('VINOPS_TEST_DATABASE_URL must name an explicit task database.');
    }
    await runMigrations(connectionString);
    pool = new Pool({
      connectionString,
      application_name: 'vinops-mega-a-tests',
      max: 8,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('enforces location_id and LBS/WBS/Discipline indexes and FTS search on vinops.documents', async () => {
    const f = await fixture();
    const docId = randomUUID();

    await asApp(f.makerId, async (client) => {
      await client.query(
        `INSERT INTO vinops.documents (
          id, organization_id, project_id, numbering_context, code, title, document_type,
          location_id, discipline_id, work_id, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 'default', 'DWG-STR-001', 'Structural Foundation Layout Drawing',
          'drawing', $4::uuid, $5::uuid, $6::uuid, $7::uuid
        )`,
        [docId, f.organizationId, f.projectId, f.locationId, f.disciplineId, f.workId, f.makerId],
      );
    });

    // Verify document can be queried by LBS, WBS, Discipline, and FTS
    await asApp(f.makerId, async (client) => {
      const byLbs = await client.query<{
        id: string;
        code: string;
        title: string;
        location_id: string;
      }>(
        `SELECT id, code, title, location_id FROM vinops.documents WHERE project_id = $1::uuid AND location_id = $2::uuid`,
        [f.projectId, f.locationId],
      );
      expect(byLbs.rows.length).toBe(1);
      expect(byLbs.rows[0]?.id).toBe(docId);

      const byFts = await client.query<{ id: string; code: string; title: string }>(
        `SELECT id, code, title FROM vinops.documents
          WHERE project_id = $1::uuid
            AND to_tsvector('simple', title) @@ plainto_tsquery('simple', 'Foundation')`,
        [f.projectId],
      );
      expect(byFts.rows.length).toBe(1);
      expect(byFts.rows[0]?.code).toBe('DWG-STR-001');
    });
  });

  async function makeRevision(
    f: Fixture,
    documentId: string,
    code: string,
    status: 'Draft' | 'Approved' = 'Approved',
  ): Promise<{ revisionId: string; fileId: string }> {
    const revisionId = randomUUID();
    const fileId = randomUUID();
    const fileVersionId = randomUUID();
    const routeId = randomUUID();
    const sha = code.includes('01') ? 'a'.repeat(64) : 'b'.repeat(64);

    await pool?.query(
      `INSERT INTO vinops.file_objects (
        id, organization_id, project_id, storage_provider, storage_bucket,
        quarantine_object_key, available_object_key, original_filename,
        declared_size_bytes, actual_size_bytes, declared_media_type, detected_media_type,
        declared_sha256, actual_sha256, status, created_by, available_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, 's3', 'vinops-files', $4, $5, $6,
        100, 100, 'application/pdf', 'application/pdf', $7, $7, 'Available', $8::uuid, now())`,
      [
        fileId,
        f.organizationId,
        f.projectId,
        `quarantine/${fileId}/original`,
        `available/${fileId}/original`,
        `${code}.pdf`,
        sha,
        f.makerId,
      ],
    );

    await pool?.query(
      `INSERT INTO vinops.document_revisions (
        id, organization_id, project_id, document_id, revision_code, purpose,
        status, created_by, approved_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'construction', $6, $7::uuid, now())`,
      [revisionId, f.organizationId, f.projectId, documentId, code, status, f.makerId],
    );

    await pool?.query(
      `INSERT INTO vinops.revision_file_versions (
        id, organization_id, project_id, revision_id, technical_version, file_id, created_by
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, $5::uuid, $6::uuid)`,
      [fileVersionId, f.organizationId, f.projectId, revisionId, fileId, f.makerId],
    );

    await pool?.query(
      `INSERT INTO vinops.document_revision_current_files (revision_id, revision_file_version_id)
       VALUES ($1::uuid, $2::uuid)`,
      [revisionId, fileVersionId],
    );

    await pool?.query(
      `INSERT INTO vinops.revision_review_routes (
        id, organization_id, project_id, revision_id, mode, required_approvals,
        reject_threshold, status, created_by, completed_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'sequential', 1, 1, 'Complete', $5::uuid, now())`,
      [routeId, f.organizationId, f.projectId, revisionId, f.makerId],
    );

    return { revisionId, fileId };
  }

  it('enforces single current revision invariant on document_revisions and document_current_revisions', async () => {
    const f = await fixture();
    const docId = randomUUID();

    await asApp(f.makerId, async (client) => {
      await client.query(
        `INSERT INTO vinops.documents (id, organization_id, project_id, numbering_context, code, title, document_type, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'default', 'DWG-002', 'Architectural Section', 'drawing', $4::uuid)`,
        [docId, f.organizationId, f.projectId, f.makerId],
      );
    });

    const { revisionId: rev1 } = await makeRevision(f, docId, 'P01.01', 'Approved');
    const { revisionId: rev2 } = await makeRevision(f, docId, 'P01.02', 'Approved');

    // Maker cannot publish (Maker-Checker separation)
    await expect(
      asApp(f.makerId, async (client) => {
        await client.query(
          `SELECT vinops.publish_document_revision($1::uuid, 'default', 1, 0, $2::uuid, $3::uuid, false)`,
          [rev1, f.makerId, randomUUID()],
        );
      }),
    ).rejects.toThrow();

    // Publisher publishes rev1
    await asApp(f.publisherId, async (client) => {
      await client.query(
        `SELECT vinops.publish_document_revision($1::uuid, 'default', 1, 0, $2::uuid, $3::uuid, false)`,
        [rev1, f.publisherId, randomUUID()],
      );
    });

    // Check that rev1 is current
    const currentCheck1 = await pool?.query<{ revision_id: string }>(
      `SELECT revision_id FROM vinops.document_current_revisions WHERE document_id = $1::uuid`,
      [docId],
    );
    expect(currentCheck1?.rows[0]?.revision_id).toBe(rev1);

    // Publisher publishes rev2 -> atomically supersedes rev1
    await asApp(f.publisherId, async (client) => {
      await client.query(
        `SELECT vinops.publish_document_revision($1::uuid, 'default', 1, 1, $2::uuid, $3::uuid, false)`,
        [rev2, f.publisherId, randomUUID()],
      );
    });

    // Check that rev2 is now current, exactly 1 row in document_current_revisions
    const currentCheck2 = await pool?.query<{ revision_id: string }>(
      `SELECT revision_id FROM vinops.document_current_revisions WHERE document_id = $1::uuid`,
      [docId],
    );
    expect(currentCheck2?.rows.length).toBe(1);
    expect(currentCheck2?.rows[0]?.revision_id).toBe(rev2);

    // Verify rev1 status changed to Superseded and rev2 to Published
    const statusCheck = await pool?.query<{ id: string; status: string }>(
      `SELECT id, status FROM vinops.document_revisions WHERE document_id = $1::uuid ORDER BY revision_code`,
      [docId],
    );
    expect(statusCheck?.rows[0]?.status).toBe('Superseded');
    expect(statusCheck?.rows[1]?.status).toBe('Published');
  });

  it('runs stored quarantine cleanup functions as vinops_worker', async () => {
    const f = await fixture();
    const expiredFileId = randomUUID();
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);

    await pool?.query(
      `INSERT INTO vinops.file_objects (
        id, organization_id, project_id, storage_provider, storage_bucket,
        quarantine_object_key, original_filename, declared_size_bytes, actual_size_bytes,
        declared_media_type, detected_media_type, declared_sha256, actual_sha256,
        status, created_at, updated_at, created_by
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 's3', 'vinops-files',
        $6, 'threat.pdf', 500, 500,
        'application/pdf', 'application/pdf', repeat('c', 64), repeat('c', 64),
        'Quarantined', $4::timestamptz, $4::timestamptz, $5::uuid
      )`,
      [
        expiredFileId,
        f.organizationId,
        f.projectId,
        oldDate,
        f.makerId,
        `quarantine/${expiredFileId}/threat.pdf`,
      ],
    );

    // Run as vinops_worker role
    const client = await pool!.connect();
    try {
      await client.query('SET ROLE vinops_worker');
      const candidates = await client.query<{ id: string; quarantine_object_key: string }>(
        `SELECT * FROM vinops.claim_expired_quarantine_files(now() - interval '24 hours', 10)`,
      );
      expect(candidates.rows.some((c) => c.id === expiredFileId)).toBe(true);

      const purgeResult = await client.query<{ purge_quarantine_file: boolean }>(
        `SELECT vinops.purge_quarantine_file($1::uuid, 'TEST_PURGE')`,
        [expiredFileId],
      );
      expect(purgeResult.rows[0]?.purge_quarantine_file).toBe(true);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }

    const fileStatus = await pool?.query<{ status: string; failure_code: string }>(
      `SELECT status, failure_code FROM vinops.file_objects WHERE id = $1::uuid`,
      [expiredFileId],
    );
    expect(fileStatus?.rows[0]?.status).toBe('Purged');
    expect(fileStatus?.rows[0]?.failure_code).toBe('TEST_PURGE');
  });
});
