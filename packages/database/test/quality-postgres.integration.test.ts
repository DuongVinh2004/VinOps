import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_TEST_DATABASE_URL ?? `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat3_test`;

let pool: Pool;

const fixture = {
  userAdmin: '00000000-0000-4000-8000-000000007001',
  userSupervisor: '00000000-0000-4000-8000-000000007002',
  userContractor: '00000000-0000-4000-8000-000000007003',
  organizationA: '00000000-0000-4000-8000-000000007010',
  projectA: '00000000-0000-4000-8000-000000007020',
  packageA: '00000000-0000-4000-8000-000000007030',
} as const;

describe('Quality & Field Records Database Invariants', () => {
  beforeAll(async () => {
    await runMigrations(connectionString);
    pool = new Pool({
      connectionString,
      application_name: 'vinops-quality-test',
      max: 2,
    });

    // Seed baseline entities
    await pool.query(`
      INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
      VALUES
        ('${fixture.userAdmin}', 'admin-q@vinops.test', 'Admin Q', 'hash'),
        ('${fixture.userSupervisor}', 'tvgs@vinops.test', 'TVGS Kỹ sư', 'hash'),
        ('${fixture.userContractor}', 'cht@vinops.test', 'Chỉ huy trưởng', 'hash')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organizations (id, code, name, created_by)
      VALUES ('${fixture.organizationA}', 'ORGQUAL', 'Organization Quality', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
      VALUES
        ('${randomUUID()}', '${fixture.organizationA}', '${fixture.userAdmin}', ARRAY['organization_owner'], 'Active')
      ON CONFLICT (organization_id, user_id) DO NOTHING;

      INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
      VALUES ('${fixture.projectA}', '${fixture.organizationA}', 'PRJ-Q01', 'Dự án Nghiệm thu', 'Asia/Bangkok', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
      VALUES
        ('${randomUUID()}', '${fixture.organizationA}', '${fixture.projectA}', '${fixture.userAdmin}', ARRAY['project_admin'], 'Active', now()),
        ('${randomUUID()}', '${fixture.organizationA}', '${fixture.projectA}', '${fixture.userSupervisor}', ARRAY['supervisor'], 'Active', now()),
        ('${randomUUID()}', '${fixture.organizationA}', '${fixture.projectA}', '${fixture.userContractor}', ARRAY['contractor'], 'Active', now())
      ON CONFLICT (project_id, user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('enforces uniqueness: 1 daily log per day per contract package', async () => {
    const logId1 = randomUUID();
    const logId2 = randomUUID();
    const date = `${2050 + Math.floor(Math.random() * 10000)}-01-01`;

    await pool.query(
      `INSERT INTO vinops.daily_logs (id, organization_id, project_id, contract_package_id, log_date, shift_code, status, author_unit, created_by)
       VALUES ($1, $2, $3, $4, $5, 'day', 'Draft', 'Nhà thầu A', $6)`,
      [
        logId1,
        fixture.organizationA,
        fixture.projectA,
        fixture.packageA,
        date,
        fixture.userContractor,
      ],
    );

    await expect(
      pool.query(
        `INSERT INTO vinops.daily_logs (id, organization_id, project_id, contract_package_id, log_date, shift_code, status, author_unit, created_by)
         VALUES ($1, $2, $3, $4, $5, 'day', 'Draft', 'Nhà thầu A', $6)`,
        [
          logId2,
          fixture.organizationA,
          fixture.projectA,
          fixture.packageA,
          date,
          fixture.userContractor,
        ],
      ),
    ).rejects.toThrow();
  });

  it('freezes daily log when Confirmed: blocks update on daily_logs content', async () => {
    const logId = randomUUID();
    const date = `${2050 + Math.floor(Math.random() * 10000)}-01-02`;

    // Insert draft daily log
    await pool.query(
      `INSERT INTO vinops.daily_logs (id, organization_id, project_id, contract_package_id, log_date, shift_code, status, author_unit, work_summary, created_by)
       VALUES ($1, $2, $3, $4, $5, 'day', 'Draft', 'Nhà thầu A', 'Đổ bê tông sàn tầng 2', $6)`,
      [
        logId,
        fixture.organizationA,
        fixture.projectA,
        fixture.packageA,
        date,
        fixture.userContractor,
      ],
    );

    // Update is allowed when Draft
    await pool.query(
      `UPDATE vinops.daily_logs SET work_summary = 'Đổ bê tông sàn tầng 2 và dầm D1' WHERE id = $1`,
      [logId],
    );

    // Confirm the log with both signatures
    await pool.query(
      `UPDATE vinops.daily_logs
          SET status = 'Confirmed',
              site_manager_signed_by = $2,
              site_manager_signed_at = now(),
              site_manager_signature_data = 'data:image/png;base64,cht_sig',
              supervisor_signed_by = $3,
              supervisor_signed_at = now(),
              supervisor_signature_data = 'data:image/png;base64,tvgs_sig'
        WHERE id = $1`,
      [logId, fixture.userContractor, fixture.userSupervisor],
    );

    // Attempting to modify work_summary after Confirmed MUST fail via trigger
    await expect(
      pool.query(
        `UPDATE vinops.daily_logs SET work_summary = 'Cố tình sửa nhật ký đã ký' WHERE id = $1`,
        [logId],
      ),
    ).rejects.toThrow(/frozen against content modification/u);
  });

  it('freezes child tables: blocks insert/update/delete on manpower, weather, equipment when parent is Confirmed', async () => {
    const logId = randomUUID();
    const date = `${2050 + Math.floor(Math.random() * 10000)}-01-03`;

    await pool.query(
      `INSERT INTO vinops.daily_logs (id, organization_id, project_id, contract_package_id, log_date, shift_code, status, author_unit, created_by)
       VALUES ($1, $2, $3, $4, $5, 'day', 'Draft', 'Nhà thầu A', $6)`,
      [
        logId,
        fixture.organizationA,
        fixture.projectA,
        fixture.packageA,
        date,
        fixture.userContractor,
      ],
    );

    // Add child entries while Draft
    const manpowerId = randomUUID();
    await pool.query(
      `INSERT INTO vinops.daily_manpower (id, daily_log_id, trade_or_subcontractor, headcount, hours_worked)
       VALUES ($1, $2, 'Tổ cốp pha', 12, 8.0)`,
      [manpowerId, logId],
    );

    const weatherId = randomUUID();
    await pool.query(
      `INSERT INTO vinops.daily_weather (id, daily_log_id, time_of_day, temperature_c, weather_condition, rainfall_mm, source)
       VALUES ($1, $2, 'morning', 29.5, 'Sunny', 0.0, 'crawled')`,
      [weatherId, logId],
    );

    const equipmentId = randomUUID();
    await pool.query(
      `INSERT INTO vinops.daily_equipment (id, daily_log_id, equipment_name, quantity, hours_worked, operational_status)
       VALUES ($1, $2, 'Máy trộn bê tông 500L', 2, 7.5, 'Operational')`,
      [equipmentId, logId],
    );

    // Freeze log
    await pool.query(`UPDATE vinops.daily_logs SET status = 'Confirmed' WHERE id = $1`, [logId]);

    // Any modification to child tables MUST fail via trigger
    await expect(
      pool.query(
        `INSERT INTO vinops.daily_manpower (id, daily_log_id, trade_or_subcontractor, headcount)
         VALUES ($1, $2, 'Tổ sắt', 8)`,
        [randomUUID(), logId],
      ),
    ).rejects.toThrow(/Cannot modify child records for Confirmed daily log/u);

    await expect(
      pool.query(`UPDATE vinops.daily_weather SET temperature_c = 35.0 WHERE id = $1`, [weatherId]),
    ).rejects.toThrow(/Cannot modify child records for Confirmed daily log/u);

    await expect(
      pool.query(`DELETE FROM vinops.daily_equipment WHERE id = $1`, [equipmentId]),
    ).rejects.toThrow(/Cannot modify child records for Confirmed daily log/u);
  });
});
