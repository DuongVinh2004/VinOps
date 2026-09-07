import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const seedIds = {
  owner: '00000000-0000-4000-8000-000000000101',
  member: '00000000-0000-4000-8000-000000000102',
  reviewer: '00000000-0000-4000-8000-000000000103',
  publisher: '00000000-0000-4000-8000-000000000104',
  organization: '00000000-0000-4000-8000-000000000201',
  project: '00000000-0000-4000-8000-000000000301',
  entitlement: '00000000-0000-4000-8000-000000000401',
  organizationMembership: '00000000-0000-4000-8000-000000000501',
  memberOrganizationMembership: '00000000-0000-4000-8000-000000000502',
  reviewerOrganizationMembership: '00000000-0000-4000-8000-000000000503',
  publisherOrganizationMembership: '00000000-0000-4000-8000-000000000504',
  projectMembership: '00000000-0000-4000-8000-000000000601',
  reviewerMembership: '00000000-0000-4000-8000-000000000602',
  publisherMembership: '00000000-0000-4000-8000-000000000603',
  ownerScope: '00000000-0000-4000-8000-000000000611',
  reviewerScope: '00000000-0000-4000-8000-000000000612',
  publisherScope: '00000000-0000-4000-8000-000000000613',
  calendar: '00000000-0000-4000-8000-000000000701',
  numbering: '00000000-0000-4000-8000-000000000801',
} as const;

function assertTaskOwnedDatabase(connectionString: string): void {
  const database = new URL(connectionString).pathname.replace(/^\//u, '');
  if (!/^vinops_(?:mega00[12]|chat2)(?:_test|_i[12]_test)?$/u.test(database)) {
    throw new Error(
      'Deterministic seed may run only against a task-owned VinOps Mega 001, Mega 002 or chat2 database.',
    );
  }
}

export async function seedDeterministicPlatform(connectionString: string): Promise<void> {
  assertTaskOwnedDatabase(connectionString);
  await runMigrations(connectionString);
  const pool = new Pool({
    connectionString,
    application_name: 'vinops-mega001-deterministic-seed',
    max: 1,
  });
  try {
    await pool.query(
      `INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
       VALUES
         ($1::uuid, 'owner@vinops.test', 'Synthetic Owner', 'scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA'),
         ($2::uuid, 'member@vinops.test', 'Synthetic Member', 'scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA'),
         ($3::uuid, 'reviewer@vinops.test', 'Synthetic Reviewer', 'scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA'),
         ($4::uuid, 'publisher@vinops.test', 'Synthetic Publisher', 'scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA')
       ON CONFLICT (id) DO NOTHING`,
      [seedIds.owner, seedIds.member, seedIds.reviewer, seedIds.publisher],
    );
    await pool.query(
      `INSERT INTO vinops.platform_entitlements (id, user_id, capability, granted_by)
       VALUES ($1::uuid, $2::uuid, 'organization_create', 'deterministic-seed')
       ON CONFLICT (user_id, capability) DO NOTHING`,
      [seedIds.entitlement, seedIds.owner],
    );
    await pool.query(
      `INSERT INTO vinops.organizations (id, code, name, created_by)
       VALUES ($1::uuid, 'SYNTHETIC', 'Synthetic VinOps Organization', $2::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [seedIds.organization, seedIds.owner],
    );
    await pool.query(
      `INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, ARRAY['organization_owner'], 'Active'),
         ($4::uuid, $2::uuid, $5::uuid, ARRAY['organization_member'], 'Active'),
         ($6::uuid, $2::uuid, $7::uuid, ARRAY['organization_member'], 'Active'),
         ($8::uuid, $2::uuid, $9::uuid, ARRAY['organization_member'], 'Active')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [
        seedIds.organizationMembership,
        seedIds.organization,
        seedIds.owner,
        seedIds.memberOrganizationMembership,
        seedIds.member,
        seedIds.reviewerOrganizationMembership,
        seedIds.reviewer,
        seedIds.publisherOrganizationMembership,
        seedIds.publisher,
      ],
    );
    await pool.query(
      `INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
       VALUES ($1::uuid, $2::uuid, 'SYN-001', 'Synthetic Platform Project', 'Asia/Bangkok', $3::uuid)
       ON CONFLICT (organization_id, code) DO NOTHING`,
      [seedIds.project, seedIds.organization, seedIds.owner],
    );
    await pool.query(
      `INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, ARRAY['project_admin'], 'Active', now()),
         ($5::uuid, $2::uuid, $3::uuid, $6::uuid, ARRAY['assigned_reviewer'], 'Active', now()),
         ($7::uuid, $2::uuid, $3::uuid, $8::uuid, ARRAY['pm_cht'], 'Active', now())
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [
        seedIds.projectMembership,
        seedIds.organization,
        seedIds.project,
        seedIds.owner,
        seedIds.reviewerMembership,
        seedIds.reviewer,
        seedIds.publisherMembership,
        seedIds.publisher,
      ],
    );
    await pool.query(
      `INSERT INTO vinops.member_scopes (
        id, organization_id, project_id, project_member_id, scope_type, scope_id, actions
      ) VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'project', $3::uuid,
          ARRAY['read','document.create','revision.create','revision.submit','revision.publish','revision.withdraw','comment.dispose','annotation.create','transmittal.create']),
        ($5::uuid, $2::uuid, $3::uuid, $6::uuid, 'project', $3::uuid, ARRAY['read']),
        ($7::uuid, $2::uuid, $3::uuid, $8::uuid, 'project', $3::uuid, ARRAY['read','revision.publish'])
       ON CONFLICT (project_member_id, scope_type, scope_id) DO NOTHING`,
      [
        seedIds.ownerScope,
        seedIds.organization,
        seedIds.project,
        seedIds.projectMembership,
        seedIds.reviewerScope,
        seedIds.reviewerMembership,
        seedIds.publisherScope,
        seedIds.publisherMembership,
      ],
    );
    await pool.query(
      `INSERT INTO vinops.project_calendars (id, organization_id, project_id, name, timezone, working_days, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Default', 'Asia/Bangkok', ARRAY[1,2,3,4,5]::smallint[], $4::uuid)
       ON CONFLICT (project_id, name) DO NOTHING`,
      [seedIds.calendar, seedIds.organization, seedIds.project, seedIds.owner],
    );
    await pool.query(
      `INSERT INTO vinops.numbering_profiles (id, organization_id, project_id, code, name, template, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'DEFAULT', 'Default', '{PROJECT}-{SEQ:05}', $4::uuid)
       ON CONFLICT (project_id, code) DO NOTHING`,
      [seedIds.numbering, seedIds.organization, seedIds.project, seedIds.owner],
    );
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.VINOPS_DATABASE_URL;
  if (connectionString === undefined) {
    throw new Error('VINOPS_DATABASE_URL is required for deterministic seed.');
  }
  await seedDeterministicPlatform(connectionString);
  console.log('Seeded deterministic VinOps platform and Document Control data.');
}

if (
  process.argv[1] !== undefined &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname
) {
  await main();
}
