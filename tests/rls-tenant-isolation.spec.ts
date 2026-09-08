import { randomUUID } from 'node:crypto';
import { Pool } from '@vinops/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../packages/database/src/migrate.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const defaultConn = `postgresql://${dbAuth}@127.0.0.1:5432/vinops_mega001_test`;
const connectionString = process.env.VINOPS_TEST_DATABASE_URL ?? defaultConn;
const isCi = process.env.CI === 'true' || process.env.CI === '1';

let pool: Pool | undefined;
let isDbReachable = false;

const ids = {
  userA: '10000000-0000-4000-8000-000000000001',
  userB: '10000000-0000-4000-8000-000000000002',
  orgA: '20000000-0000-4000-8000-000000000001',
  orgB: '20000000-0000-4000-8000-000000000002',
  projectA: '30000000-0000-4000-8000-000000000001',
  projectB: '30000000-0000-4000-8000-000000000002',
  orgMemberA: '40000000-0000-4000-8000-000000000001',
  orgMemberB: '40000000-0000-4000-8000-000000000002',
  projMemberA: '50000000-0000-4000-8000-000000000001',
  projMemberB: '50000000-0000-4000-8000-000000000002',
  fileA: '60000000-0000-4000-8000-000000000001',
  acceptanceA: '70000000-0000-4000-8000-000000000001',
  dailyLogA: '80000000-0000-4000-8000-000000000001',
  contractPackageA: '90000000-0000-4000-8000-000000000001',
} as const;

const validSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

beforeAll(async () => {
  pool = new Pool({
    connectionString,
    application_name: 'vinops-rls-tenant-isolation-test',
    connectionTimeoutMillis: 5000,
    max: 2,
  });

  try {
    const check = await pool.query('SELECT 1');
    isDbReachable = check.rowCount === 1;
  } catch (error) {
    isDbReachable = false;
    if (isCi) {
      throw new Error(
        `[CI FAIL] Postgres database is unreachable at ${connectionString}. CI integration tests must run against real infra: ${String(error)}`,
        { cause: error },
      );
    }
    return;
  }

  await runMigrations(connectionString);

  // Seed Tenant A and Tenant B foundations
  await pool.query(`
    INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
    VALUES
      ('${ids.userA}', 'rls-tenant-a@vinops.test', 'Tenant A Actor', 'fixture-hash'),
      ('${ids.userB}', 'rls-tenant-b@vinops.test', 'Tenant B Actor', 'fixture-hash')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organizations (id, code, name, created_by)
    VALUES
      ('${ids.orgA}', 'RLS-ORGA', 'Organization A', '${ids.userA}'),
      ('${ids.orgB}', 'RLS-ORGB', 'Organization B', '${ids.userB}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
    VALUES
      ('${ids.orgMemberA}', '${ids.orgA}', '${ids.userA}', ARRAY['organization_owner'], 'Active'),
      ('${ids.orgMemberB}', '${ids.orgB}', '${ids.userB}', ARRAY['organization_owner'], 'Active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO vinops.projects (id, organization_id, code, name, timezone, status, created_by)
    VALUES
      ('${ids.projectA}', '${ids.orgA}', 'RLS-PRJA', 'Project A Secure', 'Asia/Bangkok', 'Active', '${ids.userA}'),
      ('${ids.projectB}', '${ids.orgB}', 'RLS-PRJB', 'Project B Secure', 'Asia/Bangkok', 'Active', '${ids.userB}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
    VALUES
      ('${ids.projMemberA}', '${ids.orgA}', '${ids.projectA}', '${ids.userA}', ARRAY['project_admin'], 'Active', now()),
      ('${ids.projMemberB}', '${ids.orgB}', '${ids.projectB}', '${ids.userB}', ARRAY['project_admin'], 'Active', now())
    ON CONFLICT (project_id, user_id) DO NOTHING;
  `);

  // Seed Tenant A owned records (file_objects, acceptance_records, daily_logs)
  await pool.query(`
    INSERT INTO vinops.file_objects (
      id, organization_id, project_id, storage_provider, storage_bucket,
      quarantine_object_key, original_filename, declared_size_bytes,
      declared_media_type, declared_sha256, status, created_by
    ) VALUES (
      '${ids.fileA}', '${ids.orgA}', '${ids.projectA}', 's3', 'vinops-files',
      'quarantine/${ids.fileA}/document.pdf', 'tenant_a_blueprint.pdf', 1024,
      'application/pdf', '${validSha256}', 'Pending', '${ids.userA}'
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.acceptance_records (
      id, organization_id, project_id, code, record_type, legal_basis,
      result, status, created_by
    ) VALUES (
      '${ids.acceptanceA}', '${ids.orgA}', '${ids.projectA}', 'AC-PRJA-001', 'work_acceptance',
      'Nghi dinh 207/2026/ND-CP & Thong tu 32/2026/TT-BXD', 'Accepted', 'Draft', '${ids.userA}'
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.daily_logs (
      id, organization_id, project_id, contract_package_id, log_date,
      shift_code, status, author_unit, work_summary, created_by
    ) VALUES (
      '${ids.dailyLogA}', '${ids.orgA}', '${ids.projectA}', '${ids.contractPackageA}', '2026-09-08',
      'day', 'Draft', 'Chinh', 'Tenant A concrete pouring foundation', '${ids.userA}'
    ) ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await pool?.end();
});

describe('Multi-Tenant PostgreSQL RLS & BOLA/IDOR Negative Tests', () => {
  it('prevents Tenant B from reading or tampering with Tenant A projects (IDOR & BOLA)', async () => {
    if (!isDbReachable) {
      if (isCi) throw new Error('Database unreachable in CI');
      return;
    }
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE vinops_app');
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        ids.userB,
        randomUUID(),
      ]);

      // 1. Negative Read: Tenant B query cannot find Project A
      const scopedQuery = await client.query<{ id: string }>(
        'SELECT id FROM vinops.projects WHERE id = $1::uuid',
        [ids.projectA],
      );
      expect(scopedQuery.rows).toHaveLength(0);

      const allVisibleProjects = await client.query<{ id: string }>(
        'SELECT id FROM vinops.projects ORDER BY id',
      );
      expect(allVisibleProjects.rows.map((r) => r.id)).toContain(ids.projectB);
      expect(allVisibleProjects.rows.map((r) => r.id)).not.toContain(ids.projectA);

      // 2. Negative Write (IDOR): Tenant B cannot update Project A
      const updateAttempt = await client.query(
        `UPDATE vinops.projects SET name = 'BOLA-Hacked' WHERE id = $1::uuid`,
        [ids.projectA],
      );
      expect(updateAttempt.rowCount).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('prevents Tenant B from reading, modifying, or creating file_objects in Tenant A project', async () => {
    if (!isDbReachable) {
      if (isCi) throw new Error('Database unreachable in CI');
      return;
    }
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE vinops_app');
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        ids.userB,
        randomUUID(),
      ]);

      // 1. Negative Read: Tenant B cannot see Tenant A file_objects
      const fileQuery = await client.query<{ id: string }>(
        'SELECT id FROM vinops.file_objects WHERE id = $1::uuid',
        [ids.fileA],
      );
      expect(fileQuery.rows).toHaveLength(0);

      // 2. Negative Update: Tenant B cannot alter metadata of Tenant A file
      const updateFile = await client.query(
        `UPDATE vinops.file_objects SET original_filename = 'tampered.pdf' WHERE id = $1::uuid`,
        [ids.fileA],
      );
      expect(updateFile.rowCount).toBe(0);

      // 3. Negative Insert (BOLA): Tenant B cannot insert file_object belonging to Tenant A project
      const maliciousFileId = randomUUID();
      await expect(
        client.query(
          `INSERT INTO vinops.file_objects (
            id, organization_id, project_id, storage_provider, storage_bucket,
            quarantine_object_key, original_filename, declared_size_bytes,
            declared_media_type, declared_sha256, status, created_by
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, 's3', 'vinops-files',
            $4, 'malicious_inject.pdf', 512, 'application/pdf', $5, 'Pending', $6::uuid
          )`,
          [
            maliciousFileId,
            ids.orgA,
            ids.projectA,
            `quarantine/${maliciousFileId}/inject.pdf`,
            validSha256,
            ids.userB,
          ],
        ),
      ).rejects.toThrow(/violates row-level security policy/iu);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('prevents Tenant B from accessing or forging acceptance_records across tenant boundary', async () => {
    if (!isDbReachable) {
      if (isCi) throw new Error('Database unreachable in CI');
      return;
    }
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE vinops_app');
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        ids.userB,
        randomUUID(),
      ]);

      // 1. Negative Read: Tenant B cannot read Tenant A acceptance record
      const recordQuery = await client.query<{ id: string }>(
        'SELECT id FROM vinops.acceptance_records WHERE id = $1::uuid',
        [ids.acceptanceA],
      );
      expect(recordQuery.rows).toHaveLength(0);

      // 2. Negative Update: Tenant B cannot tamper with Tenant A acceptance status
      const updateRecord = await client.query(
        `UPDATE vinops.acceptance_records SET status = 'Completed', result = 'Accepted' WHERE id = $1::uuid`,
        [ids.acceptanceA],
      );
      expect(updateRecord.rowCount).toBe(0);

      // 3. Negative Insert (BOLA): Tenant B cannot forge an acceptance record in Tenant A project
      const forgedRecordId = randomUUID();
      await expect(
        client.query(
          `INSERT INTO vinops.acceptance_records (
            id, organization_id, project_id, code, record_type, legal_basis,
            result, status, created_by
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, 'FORGED-AC-001', 'work_acceptance',
            'Nghi dinh 207/2026/ND-CP', 'Accepted', 'Draft', $4::uuid
          )`,
          [forgedRecordId, ids.orgA, ids.projectA, ids.userB],
        ),
      ).rejects.toThrow(/violates row-level security policy/iu);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('prevents Tenant B from viewing, modifying, or appending daily_logs in Tenant A project', async () => {
    if (!isDbReachable) {
      if (isCi) throw new Error('Database unreachable in CI');
      return;
    }
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE vinops_app');
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        ids.userB,
        randomUUID(),
      ]);

      // 1. Negative Read: Tenant B cannot read Tenant A daily logs
      const logQuery = await client.query<{ id: string }>(
        'SELECT id FROM vinops.daily_logs WHERE id = $1::uuid',
        [ids.dailyLogA],
      );
      expect(logQuery.rows).toHaveLength(0);

      // 2. Negative Update: Tenant B cannot modify Tenant A daily log work summary
      const updateLog = await client.query(
        `UPDATE vinops.daily_logs SET work_summary = 'Unauthorized tampering' WHERE id = $1::uuid`,
        [ids.dailyLogA],
      );
      expect(updateLog.rowCount).toBe(0);

      // 3. Negative Insert (BOLA): Tenant B cannot insert daily log into Tenant A project
      const forgedLogId = randomUUID();
      await expect(
        client.query(
          `INSERT INTO vinops.daily_logs (
            id, organization_id, project_id, contract_package_id, log_date,
            shift_code, status, author_unit, work_summary, created_by
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, '2026-09-09',
            'day', 'Draft', 'Chinh', 'Forged log entry by Tenant B', $5::uuid
          )`,
          [forgedLogId, ids.orgA, ids.projectA, ids.contractPackageA, ids.userB],
        ),
      ).rejects.toThrow(/violates row-level security policy/iu);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
