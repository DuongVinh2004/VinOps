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
  const makerId = randomUUID();
  const reviewerId = randomUUID();
  const publisherId = randomUUID();
  const code = `T${organizationId.replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  await pool.query(
    `INSERT INTO vinops.users (id, email_normalized, display_name, password_hash) VALUES
      ($1::uuid, $4, 'Synthetic Maker', 'hash'),
      ($2::uuid, $5, 'Synthetic Reviewer', 'hash'),
      ($3::uuid, $6, 'Synthetic Publisher', 'hash')`,
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
     VALUES ($1::uuid, $2, 'Synthetic Document Tenant', $3::uuid)`,
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
     VALUES ($1::uuid, $2::uuid, 'DOC', 'Synthetic Document Project', 'Asia/Bangkok', 'Active', $3::uuid)`,
    [projectId, organizationId, makerId],
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
  return { organizationId, projectId, makerId, reviewerId, publisherId };
}

async function document(f: Fixture, code: string): Promise<string> {
  const id = randomUUID();
  await pool?.query(
    `INSERT INTO vinops.documents (
      id, organization_id, project_id, numbering_context, code, title, document_type, created_by
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'default', $4, 'Synthetic Drawing', 'drawing', $5::uuid)`,
    [id, f.organizationId, f.projectId, code, f.makerId],
  );
  return id;
}

async function approvedRevision(f: Fixture, documentId: string, code: string): Promise<string> {
  const revisionId = randomUUID();
  const fileId = randomUUID();
  const fileVersionId = randomUUID();
  const routeId = randomUUID();
  await pool?.query(
    `INSERT INTO vinops.file_objects (
      id, organization_id, project_id, storage_provider, storage_bucket,
      quarantine_object_key, available_object_key, original_filename,
      declared_size_bytes, actual_size_bytes, declared_media_type, detected_media_type,
      declared_sha256, actual_sha256, status, created_by, available_at
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, 's3', 'vinops-files', $4, $5, $6,
      8, 8, 'application/pdf', 'application/pdf', $7, $7, 'Available', $8::uuid, now())`,
    [
      fileId,
      f.organizationId,
      f.projectId,
      `quarantine/${fileId}/original`,
      `available/${fileId}/original`,
      `${code}.pdf`,
      'a'.repeat(64),
      f.makerId,
    ],
  );
  await pool?.query(
    `INSERT INTO vinops.document_revisions (
      id, organization_id, project_id, document_id, revision_code, purpose,
      status, created_by, approved_at
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'construction', 'Approved', $6::uuid, now())`,
    [revisionId, f.organizationId, f.projectId, documentId, code, f.makerId],
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
  return revisionId;
}

async function publish(
  f: Fixture,
  revisionId: string,
  expectedCurrentVersion: number,
  failBeforeCommit = false,
): Promise<void> {
  await asApp(f.publisherId, async (client) => {
    const version = await client.query<{ version: string }>(
      'SELECT version::text FROM vinops.document_revisions WHERE id = $1::uuid',
      [revisionId],
    );
    await client.query(
      `SELECT * FROM vinops.publish_document_revision(
        $1::uuid, 'default', $2::bigint, $3::bigint, $4::uuid, $5::uuid, $6
      )`,
      [
        revisionId,
        version.rows[0]?.version,
        expectedCurrentVersion,
        f.publisherId,
        randomUUID(),
        failBeforeCommit,
      ],
    );
  });
}

describePostgres('Document Control PostgreSQL invariants', () => {
  beforeAll(async () => {
    if (connectionString === undefined) return;
    const database = new URL(connectionString).pathname.replace(/^\//u, '');
    if (!/^(vinops_mega002_i[12]_test\d*|vinops_chat1_test)$/u.test(database)) {
      throw new Error(
        'VINOPS_TEST_DATABASE_URL must name an explicit VIN-MEGA-002 or chat1 task database.',
      );
    }
    await runMigrations(connectionString);
    pool = new Pool({
      connectionString,
      application_name: 'vinops-mega002-document-tests',
      max: 8,
    });
  });

  afterAll(async () => pool?.end());

  it('keeps business revisions and technical file versions separate and never changes current on upload', async () => {
    const f = await fixture();
    const documentId = await document(f, 'DOC-SEP');
    const published = await approvedRevision(f, documentId, 'P01');
    await publish(f, published, 0);
    const draft = await approvedRevision(f, documentId, 'P02');
    await pool?.query(
      `UPDATE vinops.document_revisions SET status = 'Draft', approved_at = NULL WHERE id = $1::uuid`,
      [draft],
    );
    const current = await pool?.query<{ revision_id: string }>(
      `SELECT revision_id FROM vinops.document_current_revisions WHERE document_id = $1::uuid AND context_key = 'default'`,
      [documentId],
    );
    expect(current?.rows[0]?.revision_id).toBe(published);
    const technical = await pool?.query<{ technical_version: number }>(
      'SELECT technical_version FROM vinops.revision_file_versions WHERE revision_id = $1::uuid',
      [draft],
    );
    expect(technical?.rows[0]?.technical_version).toBe(1);
  });

  it('serializes concurrent publication to exactly one winner and one conflict', async () => {
    const f = await fixture();
    const documentId = await document(f, 'DOC-RACE');
    const first = await approvedRevision(f, documentId, 'P01');
    const second = await approvedRevision(f, documentId, 'P02');
    const results = await Promise.allSettled([publish(f, first, 0), publish(f, second, 0)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const pointer = await pool?.query<{ revision_id: string }>(
      'SELECT revision_id FROM vinops.document_current_revisions WHERE document_id = $1::uuid',
      [documentId],
    );
    expect(pointer?.rowCount).toBe(1);
    const statuses = await pool?.query<{ status: string }>(
      'SELECT status FROM vinops.document_revisions WHERE id = ANY($1::uuid[]) ORDER BY status',
      [[first, second]],
    );
    expect(statuses?.rows.map((row) => row.status).sort()).toEqual(['Approved', 'Published']);
  });

  it('rolls back revision, current pointer, audit and outbox together on failure injection', async () => {
    const f = await fixture();
    const documentId = await document(f, 'DOC-ROLLBACK');
    const revisionId = await approvedRevision(f, documentId, 'P01');
    await expect(publish(f, revisionId, 0, true)).rejects.toThrow(/TEST_FAILURE_BEFORE_COMMIT/u);
    const status = await pool?.query<{ status: string }>(
      'SELECT status FROM vinops.document_revisions WHERE id = $1::uuid',
      [revisionId],
    );
    expect(status?.rows[0]?.status).toBe('Approved');
    const effects = await pool?.query<{
      current_count: string;
      audit_count: string;
      outbox_count: string;
    }>(
      `SELECT
        (SELECT count(*) FROM vinops.document_current_revisions WHERE document_id = $1::uuid)::text AS current_count,
        (SELECT count(*) FROM vinops.audit_events WHERE entity_id = $2::uuid AND action = 'revision.publish')::text AS audit_count,
        (SELECT count(*) FROM vinops.outbox_events WHERE aggregate_id = $2::uuid AND event_type = 'revision.published.v1')::text AS outbox_count`,
      [documentId, revisionId],
    );
    expect(effects?.rows[0]).toEqual({ current_count: '0', audit_count: '0', outbox_count: '0' });
  });

  it('enforces document/revision uniqueness and cross-tenant RLS non-disclosure', async () => {
    const tenantA = await fixture();
    const tenantB = await fixture();
    const documentA = await document(tenantA, 'DOC-UNIQUE');
    const documentB = await document(tenantB, 'DOC-PRIVATE');
    await expect(document(tenantA, 'DOC-UNIQUE')).rejects.toMatchObject({ code: '23505' });
    const visible = await asApp(tenantA.makerId, async (client) =>
      client.query<{ id: string }>(
        'SELECT id FROM vinops.documents WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[documentA, documentB]],
      ),
    );
    expect(visible.rows.map((row) => row.id)).toEqual([documentA]);
  });

  it('reads transmittals without recursive RLS while preserving tenant isolation', async () => {
    const tenantA = await fixture();
    const tenantB = await fixture();
    const documentId = await document(tenantA, 'DOC-RLS');
    const revisionId = await approvedRevision(tenantA, documentId, 'P01');
    const transmittalId = randomUUID();
    await pool?.query(
      `INSERT INTO vinops.transmittals (
        id, organization_id, project_id, code, purpose, status, created_by, issued_at, snapshot_sha256
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'TR-RLS', 'RLS regression', 'Issued', $4::uuid, now(), $5)`,
      [transmittalId, tenantA.organizationId, tenantA.projectId, tenantA.makerId, 'b'.repeat(64)],
    );
    await pool?.query(
      `INSERT INTO vinops.transmittal_items (
        id, organization_id, project_id, transmittal_id, document_id, revision_id,
        context_key, document_code_snapshot, document_title_snapshot,
        revision_code_snapshot, file_sha256_snapshot
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
        'default', 'DOC-RLS', 'Synthetic Drawing', 'P01', $7)`,
      [
        randomUUID(),
        tenantA.organizationId,
        tenantA.projectId,
        transmittalId,
        documentId,
        revisionId,
        'a'.repeat(64),
      ],
    );
    const sameProject = await asApp(tenantA.reviewerId, async (client) =>
      client.query<{ id: string }>('SELECT id FROM vinops.transmittals WHERE id = $1::uuid', [
        transmittalId,
      ]),
    );
    expect(sameProject.rows.map((row) => row.id)).toEqual([transmittalId]);
    const crossTenant = await asApp(tenantB.makerId, async (client) =>
      client.query<{ id: string }>('SELECT id FROM vinops.transmittals WHERE id = $1::uuid', [
        transmittalId,
      ]),
    );
    expect(crossTenant.rows).toEqual([]);
  });
});
