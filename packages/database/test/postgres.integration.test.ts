import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_TEST_DATABASE_URL ?? `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat1_test`;
const describePostgres = connectionString === undefined ? describe.skip : describe;
let pool: Pool | undefined;

const ids = {
  userA: '00000000-0000-4000-8000-000000001001',
  userB: '00000000-0000-4000-8000-000000001002',
  organizationA: '00000000-0000-4000-8000-000000002001',
  organizationB: '00000000-0000-4000-8000-000000002002',
  projectA: '00000000-0000-4000-8000-000000003001',
  projectB: '00000000-0000-4000-8000-000000003002',
  orgMemberA: '00000000-0000-4000-8000-000000004001',
  orgMemberB: '00000000-0000-4000-8000-000000004002',
  projectMemberA: '00000000-0000-4000-8000-000000005001',
  projectMemberB: '00000000-0000-4000-8000-000000005002',
} as const;

describePostgres(
  'PostgreSQL migration and RLS integration (requires an explicitly provisioned task-owned database)',
  () => {
    beforeAll(async () => {
      if (connectionString === undefined) {
        return;
      }
      const database = new URL(connectionString).pathname.replace(/^\//u, '');
      if (!/^(vinops_mega001_test|vinops_chat1_test)$/u.test(database)) {
        throw new Error(
          'VINOPS_TEST_DATABASE_URL must name the task-owned vinops_mega001_test or vinops_chat1_test database.',
        );
      }
      await runMigrations(connectionString);
      pool = new Pool({
        connectionString,
        application_name: 'vinops-mega001-postgres-integration',
        max: 1,
      });
      await pool.query(`
      INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
      VALUES
        ('${ids.userA}', 'tenant-a@vinops.test', 'Tenant A', 'hash'),
        ('${ids.userB}', 'tenant-b@vinops.test', 'Tenant B', 'hash')
      ON CONFLICT (id) DO NOTHING
    `);
      await pool.query(`
      INSERT INTO vinops.organizations (id, code, name, created_by)
      VALUES
        ('${ids.organizationA}', 'TENANTA', 'Tenant A', '${ids.userA}'),
        ('${ids.organizationB}', 'TENANTB', 'Tenant B', '${ids.userB}')
      ON CONFLICT (id) DO NOTHING
    `);
      await pool.query(`
      INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
      VALUES
        ('${ids.orgMemberA}', '${ids.organizationA}', '${ids.userA}', ARRAY['organization_owner'], 'Active'),
        ('${ids.orgMemberB}', '${ids.organizationB}', '${ids.userB}', ARRAY['organization_owner'], 'Active')
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `);
      await pool.query(`
      INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
      VALUES
        ('${ids.projectA}', '${ids.organizationA}', 'A-001', 'Project A', 'Asia/Bangkok', '${ids.userA}'),
        ('${ids.projectB}', '${ids.organizationB}', 'B-001', 'Project B', 'Asia/Bangkok', '${ids.userB}')
      ON CONFLICT (id) DO NOTHING
    `);
      await pool.query(`
      INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
      VALUES
        ('${ids.projectMemberA}', '${ids.organizationA}', '${ids.projectA}', '${ids.userA}', ARRAY['project_admin'], 'Active', now()),
        ('${ids.projectMemberB}', '${ids.organizationB}', '${ids.projectB}', '${ids.userB}', ARRAY['project_admin'], 'Active', now())
      ON CONFLICT (project_id, user_id) DO NOTHING
    `);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it('migrates from an empty task-owned database and RLS blocks an unscoped cross-tenant project query', async () => {
      const client = await pool?.connect();
      if (client === undefined) {
        throw new Error('PostgreSQL pool was not initialized.');
      }
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE vinops_app');
        await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
          ids.userA,
          randomUUID(),
        ]);
        const projects = await client.query<{ id: string }>(
          'SELECT id FROM vinops.projects ORDER BY id',
        );
        expect(projects.rows.map((project) => project.id)).toEqual([ids.projectA]);
        const attemptedCrossTenantUpdate = await client.query(
          `UPDATE vinops.projects SET name = 'should-not-change' WHERE id = $1::uuid`,
          [ids.projectB],
        );
        expect(attemptedCrossTenantUpdate.rowCount).toBe(0);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  },
);
