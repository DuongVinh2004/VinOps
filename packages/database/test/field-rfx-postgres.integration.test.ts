import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_TEST_DATABASE_URL ?? `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat2_test`;

let pool: Pool;

const fixture = {
  userAdmin: '00000000-0000-4000-8000-000000008001',
  userSupervisor: '00000000-0000-4000-8000-000000008002',
  userContractor1: '00000000-0000-4000-8000-000000008003',
  userContractor2: '00000000-0000-4000-8000-000000008004',
  userConsultant: '00000000-0000-4000-8000-000000008005',

  organizationMain: '00000000-0000-4000-8000-000000008010',
  partnerContractor1: '00000000-0000-4000-8000-000000008011',
  partnerContractor2: '00000000-0000-4000-8000-000000008012',
  partnerConsultant: '00000000-0000-4000-8000-000000008013',

  projectA: '00000000-0000-4000-8000-000000008020',
  locationNodeA: '00000000-0000-4000-8000-000000008030',
  workNodeA: '00000000-0000-4000-8000-000000008040',
} as const;

describe('Field Issues & RFX Database Invariants and RLS', () => {
  beforeAll(async () => {
    await runMigrations(connectionString);
    pool = new Pool({
      connectionString,
      application_name: 'vinops-field-rfx-integration',
      max: 2,
    });

    // Seed baseline entities
    await pool.query(`
      INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
      VALUES
        ('${fixture.userAdmin}', 'admin-rfx@vinops.test', 'Admin RFX', 'hash'),
        ('${fixture.userSupervisor}', 'tvgs-rfx@vinops.test', 'Supervisor TVGS', 'hash'),
        ('${fixture.userContractor1}', 'cont1@vinops.test', 'Contractor 1 PM', 'hash'),
        ('${fixture.userContractor2}', 'cont2@vinops.test', 'Contractor 2 PM', 'hash'),
        ('${fixture.userConsultant}', 'consultant@vinops.test', 'Consultant Engineer', 'hash')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organizations (id, code, name, created_by)
      VALUES
        ('${fixture.organizationMain}', 'MAINORG', 'Main Developer Org', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
      VALUES ('${fixture.projectA}', '${fixture.organizationMain}', 'PRJ-RFX', 'RFX Test Tower', 'Asia/Ho_Chi_Minh', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.partner_organizations (id, organization_id, project_id, code, name, created_by)
      VALUES
        ('${fixture.partnerContractor1}', '${fixture.organizationMain}', '${fixture.projectA}', 'CONT1', 'Contractor One Corp', '${fixture.userAdmin}'),
        ('${fixture.partnerContractor2}', '${fixture.organizationMain}', '${fixture.projectA}', 'CONT2', 'Contractor Two Corp', '${fixture.userAdmin}'),
        ('${fixture.partnerConsultant}', '${fixture.organizationMain}', '${fixture.projectA}', 'CONSULT', 'Consultant Design Corp', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, partner_organization_id, status, valid_from)
      VALUES
        ('${randomUUID()}', '${fixture.organizationMain}', '${fixture.projectA}', '${fixture.userAdmin}', ARRAY['project_admin'], NULL, 'Active', now()),
        ('${randomUUID()}', '${fixture.organizationMain}', '${fixture.projectA}', '${fixture.userSupervisor}', ARRAY['supervisor'], NULL, 'Active', now()),
        ('${randomUUID()}', '${fixture.organizationMain}', '${fixture.projectA}', '${fixture.userContractor1}', ARRAY['contractor'], '${fixture.partnerContractor1}', 'Active', now()),
        ('${randomUUID()}', '${fixture.organizationMain}', '${fixture.projectA}', '${fixture.userContractor2}', ARRAY['contractor'], '${fixture.partnerContractor2}', 'Active', now()),
        ('${randomUUID()}', '${fixture.organizationMain}', '${fixture.projectA}', '${fixture.userConsultant}', ARRAY['consultant'], '${fixture.partnerConsultant}', 'Active', now())
      ON CONFLICT (project_id, user_id) DO NOTHING;

      INSERT INTO vinops.location_nodes (id, organization_id, project_id, code, name, node_type, created_by)
      VALUES ('${fixture.locationNodeA}', '${fixture.organizationMain}', '${fixture.projectA}', 'B1-F01', 'Basement 1', 'Floor', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.work_nodes (id, organization_id, project_id, code, name, node_type, created_by)
      VALUES ('${fixture.workNodeA}', '${fixture.organizationMain}', '${fixture.projectA}', 'WBS-CONC', 'Concrete Works', 'work_package', '${fixture.userAdmin}')
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('RLS: contractor 1 can only see issues assigned to their organization, supervisor sees all', async () => {
    const issue1Id = randomUUID();
    const issue2Id = randomUUID();
    const issue1Code = `ISS-INT-${randomUUID().slice(0, 8)}`;
    const issue2Code = `ISS-INT-${randomUUID().slice(0, 8)}`;

    // Create issue 1 for contractor 1
    await pool.query(
      `INSERT INTO vinops.field_issues (
        id, organization_id, project_id, code, title, description, category,
        status, severity, contractor_organization_id, created_by
      ) VALUES ($1, $2, $3, $4, 'Leak in Section A', 'Detailed leak', 'quality', 'Open', 'high', $5, $6)`,
      [
        issue1Id,
        fixture.organizationMain,
        fixture.projectA,
        issue1Code,
        fixture.partnerContractor1,
        fixture.userSupervisor,
      ],
    );

    // Create issue 2 for contractor 2
    await pool.query(
      `INSERT INTO vinops.field_issues (
        id, organization_id, project_id, code, title, description, category,
        status, severity, contractor_organization_id, created_by
      ) VALUES ($1, $2, $3, $4, 'Defect in Section B', 'Detailed defect', 'quality', 'Open', 'low', $5, $6)`,
      [
        issue2Id,
        fixture.organizationMain,
        fixture.projectA,
        issue2Code,
        fixture.partnerContractor2,
        fixture.userSupervisor,
      ],
    );

    // Query as contractor 1 using vinops_app role and context
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE vinops_app');
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        fixture.userContractor1,
        randomUUID(),
      ]);

      const contractorRes = await client.query<{ id: string; code: string }>(
        'SELECT id, code FROM vinops.field_issues WHERE project_id = $1',
        [fixture.projectA],
      );

      // Contractor 1 should see issue 1, but NOT issue 2
      const ids = contractorRes.rows.map((r: { id: string; code: string }) => r.id);
      expect(ids).toContain(issue1Id);
      expect(ids).not.toContain(issue2Id);

      // Now query as supervisor
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        fixture.userSupervisor,
        randomUUID(),
      ]);

      const supervisorRes = await client.query<{ id: string; code: string }>(
        'SELECT id, code FROM vinops.field_issues WHERE project_id = $1',
        [fixture.projectA],
      );
      const superIds = supervisorRes.rows.map((r: { id: string; code: string }) => r.id);
      expect(superIds).toContain(issue1Id);
      expect(superIds).toContain(issue2Id);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('Quick Create issue stores GPS coordinates and links to LBS / WBS', async () => {
    const issueId = randomUUID();
    const lat = 21.0285;
    const lng = 105.8572;
    const issueCode = `ISS-GPS-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO vinops.field_issues (
        id, organization_id, project_id, code, title, description, category,
        status, severity, location_node_id, work_node_id, gps_latitude, gps_longitude, gps_accuracy_meters, created_by
      ) VALUES ($1, $2, $3, $4, 'Honeycomb column', 'GPS defect test', 'quality', 'Open', 'critical', $5, $6, $7, $8, 5.0, $9)`,
      [
        issueId,
        fixture.organizationMain,
        fixture.projectA,
        issueCode,
        fixture.locationNodeA,
        fixture.workNodeA,
        lat,
        lng,
        fixture.userContractor1,
      ],
    );

    const check = await pool.query<{
      code: string;
      location_node_id: string;
      work_node_id: string;
      gps_latitude: string;
      gps_longitude: string;
      version: string;
    }>(
      'SELECT code, location_node_id, work_node_id, gps_latitude, gps_longitude, version FROM vinops.field_issues WHERE id = $1',
      [issueId],
    );

    expect(check.rows[0]!.code).toBe(issueCode);
    expect(check.rows[0]!.location_node_id).toBe(fixture.locationNodeA);
    expect(check.rows[0]!.work_node_id).toBe(fixture.workNodeA);
    expect(Number(check.rows[0]!.gps_latitude)).toBeCloseTo(lat, 4);
    expect(Number(check.rows[0]!.gps_longitude)).toBeCloseTo(lng, 4);
    expect(check.rows[0]!.version).toBe('1');
  });

  it('Escalate Field Issue to RFI: links source_issue_id and updates issue', async () => {
    const issueId = randomUUID();
    const rfiId = randomUUID();
    const issueCode = `ISS-ESC-${randomUUID().slice(0, 8)}`;
    const rfiCode = `RFI-ESC-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO vinops.field_issues (
        id, organization_id, project_id, code, title, description, category,
        status, severity, created_by
      ) VALUES ($1, $2, $3, $4, 'Rebar clearance discrepancy', 'Discrepancy test', 'quality', 'Open', 'high', $5)`,
      [issueId, fixture.organizationMain, fixture.projectA, issueCode, fixture.userContractor1],
    );

    // Create RFI linking to issue
    await pool.query(
      `INSERT INTO vinops.rfi_requests (
        id, organization_id, project_id, code, title, question,
        status, priority, source_issue_id, requesting_partner_organization_id, responding_partner_organization_id,
        ball_in_court_organization_id, created_by
      ) VALUES ($1, $2, $3, $4, 'RFI for Rebar clearance', 'Need engineer resolution',
        'Submitted', 'high', $5, $6, $7, $7, $8)`,
      [
        rfiId,
        fixture.organizationMain,
        fixture.projectA,
        rfiCode,
        issueId,
        fixture.partnerContractor1,
        fixture.partnerConsultant,
        fixture.userContractor1,
      ],
    );

    // Link back to issue
    await pool.query(
      'UPDATE vinops.field_issues SET escalated_to_rfi_id = $1, version = version + 1 WHERE id = $2',
      [rfiId, issueId],
    );

    const rfiCheck = await pool.query<{
      source_issue_id: string;
      ball_in_court_organization_id: string;
    }>(
      'SELECT source_issue_id, ball_in_court_organization_id FROM vinops.rfi_requests WHERE id = $1',
      [rfiId],
    );
    expect(rfiCheck.rows[0]!.source_issue_id).toBe(issueId);
    expect(rfiCheck.rows[0]!.ball_in_court_organization_id).toBe(fixture.partnerConsultant);

    const issueCheck = await pool.query<{
      escalated_to_rfi_id: string;
      version: string;
    }>('SELECT escalated_to_rfi_id, version FROM vinops.field_issues WHERE id = $1', [issueId]);
    expect(issueCheck.rows[0]!.escalated_to_rfi_id).toBe(rfiId);
    expect(issueCheck.rows[0]!.version).toBe('2');
  });

  it('RFI official response pipeline: adds response and transitions state', async () => {
    const rfiId = randomUUID();
    const responseId = randomUUID();
    const rfiCode = `RFI-RESP-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO vinops.rfi_requests (
        id, organization_id, project_id, code, title, question,
        status, priority, requesting_partner_organization_id, responding_partner_organization_id, ball_in_court_organization_id, created_by
      ) VALUES ($1, $2, $3, $4, 'Foundation waterproof query', 'Spec unclear',
        'Under Review', 'normal', $5, $6, $6, $7)`,
      [
        rfiId,
        fixture.organizationMain,
        fixture.projectA,
        rfiCode,
        fixture.partnerContractor1,
        fixture.partnerConsultant,
        fixture.userContractor1,
      ],
    );

    // Consultant submits official response
    await pool.query(
      `INSERT INTO vinops.rfi_responses (
        id, organization_id, project_id, rfi_id, response_type, content,
        author_partner_organization_id, author_user_id
      ) VALUES ($1, $2, $3, $4, 'official_answer', 'Use 2mm PVC membrane specification standard',
        $5, $6)`,
      [
        responseId,
        fixture.organizationMain,
        fixture.projectA,
        rfiId,
        fixture.partnerConsultant,
        fixture.userConsultant,
      ],
    );

    // Transition RFI to Official Answered
    await pool.query(
      `UPDATE vinops.rfi_requests
          SET status = 'Official Answered',
               ball_in_court_organization_id = NULL,
               version = version + 1
         WHERE id = $1`,
      [rfiId],
    );

    const rfiCheck = await pool.query<{
      status: string;
      ball_in_court_organization_id: string | null;
    }>('SELECT status, ball_in_court_organization_id FROM vinops.rfi_requests WHERE id = $1', [
      rfiId,
    ]);
    expect(rfiCheck.rows[0]!.status).toBe('Official Answered');
    expect(rfiCheck.rows[0]!.ball_in_court_organization_id).toBeNull();

    const respCheck = await pool.query<{
      response_type: string;
      content: string;
    }>('SELECT response_type, content FROM vinops.rfi_responses WHERE id = $1', [responseId]);
    expect(respCheck.rows[0]!.response_type).toBe('official_answer');
    expect(respCheck.rows[0]!.content).toContain('2mm PVC membrane');
  });

  it('Submittal Maker-Checker review pipeline: Maker submits, Checker approves with Code A', async () => {
    const submittalId = randomUUID();
    const itemId = randomUUID();
    const reviewId = randomUUID();
    const submittalCode = `SUB-INT-${randomUUID().slice(0, 8)}`;

    // Maker (contractor 1) creates submittal package
    await pool.query(
      `INSERT INTO vinops.submittals (
        id, organization_id, project_id, code, title, submittal_type,
        status, maker_partner_organization_id, consultant_partner_organization_id, created_by
      ) VALUES ($1, $2, $3, $4, 'Granite tile samples', 'material_sample',
        'Draft', $5, $6, $7)`,
      [
        submittalId,
        fixture.organizationMain,
        fixture.projectA,
        submittalCode,
        fixture.partnerContractor1,
        fixture.partnerConsultant,
        fixture.userContractor1,
      ],
    );

    // Add submittal item
    await pool.query(
      `INSERT INTO vinops.submittal_items (
        id, organization_id, project_id, submittal_id, item_number, description,
        manufacturer, model_or_grade
      ) VALUES ($1, $2, $3, $4, 1, 'Vietnam White Granite 600x600', 'Phu Cat Stone Co', 'Binh Dinh White')`,
      [itemId, fixture.organizationMain, fixture.projectA, submittalId],
    );

    // Maker submits -> Under Review
    await pool.query(
      `UPDATE vinops.submittals
          SET status = 'Under Review',
              ball_in_court_organization_id = $2,
              version = version + 1
        WHERE id = $1`,
      [submittalId, fixture.partnerConsultant],
    );

    // Checker (Consultant) reviews and approves
    await pool.query(
      `INSERT INTO vinops.submittal_reviews (
        id, organization_id, project_id, submittal_id, stage, reviewer_partner_organization_id,
        reviewer_user_id, decision, comments
      ) VALUES ($1, $2, $3, $4, 'checker', $5, $6, 'Approved', 'Approved without exceptions. High quality sample.')`,
      [
        reviewId,
        fixture.organizationMain,
        fixture.projectA,
        submittalId,
        fixture.partnerConsultant,
        fixture.userConsultant,
      ],
    );

    await pool.query(
      `UPDATE vinops.submittals
          SET status = 'Approved',
              ball_in_court_organization_id = NULL,
              version = version + 1
        WHERE id = $1`,
      [submittalId],
    );

    const subCheck = await pool.query<{
      status: string;
      ball_in_court_organization_id: string | null;
      version: string;
    }>(
      'SELECT status, ball_in_court_organization_id, version FROM vinops.submittals WHERE id = $1',
      [submittalId],
    );
    expect(subCheck.rows[0]!.status).toBe('Approved');
    expect(subCheck.rows[0]!.ball_in_court_organization_id).toBeNull();
    expect(subCheck.rows[0]!.version).toBe('3');

    const itemCheck = await pool.query<{ model_or_grade: string }>(
      'SELECT model_or_grade FROM vinops.submittal_items WHERE submittal_id = $1',
      [submittalId],
    );
    expect(itemCheck.rows[0]!.model_or_grade).toBe('Binh Dinh White');
  });
});
