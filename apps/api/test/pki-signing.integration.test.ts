import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiRuntimeConfig } from '../src/api-runtime.js';
import type { RequestIdentity } from '../src/platform.service.js';
import { SigningService } from '../src/pki/signing.service.js';
import { QualityService } from '../src/quality/quality.service.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_DATABASE_URL ??
  process.env.VINOPS_TEST_DATABASE_URL ??
  `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat3_test`;

let pool: Pool;
let signingService: SigningService;
let qualityService: QualityService;

const fixture = {
  orgId: '00000000-0000-4000-8000-000000008010',
  projectId: '00000000-0000-4000-8000-000000008020',
  otherProjectId: '00000000-0000-4000-8000-000000008021',
  contractorUser: '00000000-0000-4000-8000-000000008003',
  supervisorUser: '00000000-0000-4000-8000-000000008002',
  pmuUser: '00000000-0000-4000-8000-000000008001',
  intruderUser: '00000000-0000-4000-8000-000000008099',
};

const makeIdentity = (userId: string): RequestIdentity => ({
  userId,
  sessionId: randomUUID(),
  authVersion: 1,
  authorizationVersion: 1,
});

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 2 });

  // Apply migration 017 if not already applied
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const migrationSql = await readFile(
    path.resolve(process.cwd(), 'packages/database/migrations/017_pki_digital_signatures.sql'),
    'utf8',
  );
  try {
    await pool.query(migrationSql);
  } catch {
    // Ignore if already applied
  }

  // Ensure test fixtures exist
  await pool.query(`
    INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
    VALUES
      ('${fixture.contractorUser}', 'contractor-pki@vinops.test', 'Kỹ sư Nhà thầu', 'hash'),
      ('${fixture.supervisorUser}', 'supervisor-pki@vinops.test', 'Kỹ sư TVGS Trưởng', 'hash'),
      ('${fixture.pmuUser}', 'pmu-pki@vinops.test', 'Đại diện BQLDA PMU', 'hash'),
      ('${fixture.intruderUser}', 'intruder-pki@vinops.test', 'Người dùng ngoài dự án', 'hash')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organizations (id, code, name, created_by)
    VALUES ('${fixture.orgId}', 'ORG-PKI', 'Tổ chức PKI Test', '${fixture.pmuUser}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
    VALUES
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.contractorUser}', ARRAY['contractor_representative'], 'Active'),
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.supervisorUser}', ARRAY['supervision_engineer'], 'Active'),
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.pmuUser}', ARRAY['organization_owner', 'pmu_representative'], 'Active'),
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.intruderUser}', ARRAY['contractor_representative'], 'Active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO vinops.projects (id, organization_id, code, name, timezone, status, created_by)
    VALUES
      ('${fixture.projectId}', '${fixture.orgId}', 'PRJ-PKI', 'Dự án PKI Test', 'Asia/Bangkok', 'Active', '${fixture.pmuUser}'),
      ('${fixture.otherProjectId}', '${fixture.orgId}', 'PRJ-PKI-2', 'Dự án khác', 'Asia/Bangkok', 'Active', '${fixture.pmuUser}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status)
    VALUES
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.projectId}', '${fixture.contractorUser}', ARRAY['contractor_representative'], 'Active'),
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.projectId}', '${fixture.supervisorUser}', ARRAY['supervision_engineer'], 'Active'),
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.projectId}', '${fixture.pmuUser}', ARRAY['pmu_representative', 'project_admin'], 'Active'),
      (gen_random_uuid(), '${fixture.orgId}', '${fixture.projectId}', '${fixture.intruderUser}', ARRAY['contractor_representative'], 'Active')
    ON CONFLICT (project_id, user_id) DO NOTHING;
  `);

  const mockConfig = { VINOPS_DATABASE_URL: connectionString } as unknown as ApiRuntimeConfig;
  signingService = new SigningService(mockConfig);
  qualityService = new QualityService(mockConfig);
});

afterAll(async () => {
  if (signingService) await signingService.onModuleDestroy();
  if (qualityService) await qualityService.onModuleDestroy();
  if (pool) await pool.end();
});

describe('ADR-015 PKI Remote Signing & TSA Timestamp Integration (ADR015-TST-13)', () => {
  it('executes full sequential 3-party signing flow: Contractor -> TVGS -> PMU and verifies signature', async () => {
    const contractor = makeIdentity(fixture.contractorUser);
    const supervisor = makeIdentity(fixture.supervisorUser);
    const pmu = makeIdentity(fixture.pmuUser);
    const correlationId = randomUUID();

    // 1. Create an acceptance record
    const accCode = `NT-PKI-${randomUUID().slice(0, 8)}`;
    const accRecord = (await qualityService.createAcceptanceRecord(
      contractor,
      fixture.projectId,
      {
        code: accCode,
        record_type: 'work_acceptance',
        result: 'Accepted',
      },
      correlationId,
    )) as { id: string };

    expect(accRecord.id).toBeDefined();

    // 2. Initialize 3-party sequential signing session
    const initRes = (await signingService.initSigningSessions(
      contractor,
      fixture.projectId,
      {
        signableType: 'acceptance_record',
        signableId: accRecord.id,
        signers: [
          { signingOrder: 1, role: 'contractor_rep', userId: fixture.contractorUser },
          { signingOrder: 2, role: 'tvgs_lead', userId: fixture.supervisorUser },
          { signingOrder: 3, role: 'pmu_manager', userId: fixture.pmuUser },
        ],
      },
      correlationId,
    )) as {
      totalSteps: number;
      sessions: Array<{ id: string; signingOrder: number; status: string }>;
    };

    expect(initRes.totalSteps).toBe(3);
    expect(initRes.sessions).toHaveLength(3);

    const session1 = initRes.sessions[0]!;
    const session2 = initRes.sessions[1]!;
    const session3 = initRes.sessions[2]!;

    expect(session1.status).toBe('pending');
    expect(session2.status).toBe('pending');
    expect(session3.status).toBe('pending');

    // Step 2 TVGS cannot sign yet because Step 1 is not signed
    await expect(
      signingService.signSession(
        supervisor,
        fixture.projectId,
        session2.id,
        { otpCode: '123456' },
        correlationId,
      ),
    ).rejects.toThrow();

    // 3. Step 1: Contractor Authorizes & Signs
    const auth1 = (await signingService.authorizeSession(
      contractor,
      fixture.projectId,
      session1.id,
      { providerCode: 'vnpt_smartca', authMode: 'push_notification' },
      correlationId,
    )) as { status: string; cscTransactionId: string };
    expect(auth1.status).toBe('otp_sent');
    expect(auth1.cscTransactionId).toBeDefined();

    const sign1 = (await signingService.signSession(
      contractor,
      fixture.projectId,
      session1.id,
      { cscTransactionId: auth1.cscTransactionId, otpCode: '888123' },
      correlationId,
    )) as { signatureId: string; verificationStatus: string; isProcessFinished: boolean };
    expect(sign1.verificationStatus).toBe('valid');
    expect(sign1.isProcessFinished).toBe(false);

    // Verify acceptance record updated to Contractor Signed
    const accCheck1 = await pool.query<{ status: string; contractor_signed_by: string }>(
      'SELECT status, contractor_signed_by FROM vinops.acceptance_records WHERE id = $1',
      [accRecord.id],
    );
    expect(accCheck1.rows[0]?.status).toBe('Contractor Signed');
    expect(accCheck1.rows[0]?.contractor_signed_by).toBe(fixture.contractorUser);

    // 4. Step 2: TVGS Authorizes & Signs
    const auth2 = (await signingService.authorizeSession(
      supervisor,
      fixture.projectId,
      session2.id,
      { providerCode: 'viettel_cloud_ca' },
      correlationId,
    )) as { status: string };
    expect(auth2.status).toBe('otp_sent');

    const sign2 = (await signingService.signSession(
      supervisor,
      fixture.projectId,
      session2.id,
      { otpCode: '999456' },
      correlationId,
    )) as { verificationStatus: string; isProcessFinished: boolean };
    expect(sign2.verificationStatus).toBe('valid');
    expect(sign2.isProcessFinished).toBe(false);

    const accCheck2 = await pool.query<{ status: string; supervisor_signed_by: string }>(
      'SELECT status, supervisor_signed_by FROM vinops.acceptance_records WHERE id = $1',
      [accRecord.id],
    );
    expect(accCheck2.rows[0]?.status).toBe('Supervisor Signed');

    // 5. Step 3: PMU Manager Authorizes & Signs (Final Seal)
    const auth3 = (await signingService.authorizeSession(
      pmu,
      fixture.projectId,
      session3.id,
      { providerCode: 'trust_ca' },
      correlationId,
    )) as { status: string };
    expect(auth3.status).toBe('otp_sent');

    const sign3 = (await signingService.signSession(
      pmu,
      fixture.projectId,
      session3.id,
      { otpCode: '777890' },
      correlationId,
    )) as { signatureId: string; verificationStatus: string; isProcessFinished: boolean };
    expect(sign3.verificationStatus).toBe('valid');
    expect(sign3.isProcessFinished).toBe(true);

    const accCheck3 = await pool.query<{ status: string; pmu_signed_by: string }>(
      'SELECT status, pmu_signed_by FROM vinops.acceptance_records WHERE id = $1',
      [accRecord.id],
    );
    expect(accCheck3.rows[0]?.status).toBe('Completed');

    // 6. Verification endpoint test
    const verifyRes = (await signingService.verifySignature(
      contractor,
      fixture.projectId,
      sign3.signatureId,
      correlationId,
    )) as {
      verificationStatus: string;
      isIntegrityIntact: boolean;
      documentModifiedSinceSigning: boolean;
      timestamp: { rfc3161Verified: boolean };
    };

    expect(verifyRes.verificationStatus).toBe('valid');
    expect(verifyRes.isIntegrityIntact).toBe(true);
    expect(verifyRes.documentModifiedSinceSigning).toBe(false);
    expect(verifyRes.timestamp.rfc3161Verified).toBe(true);
  });

  it('handles rejection workflow: TVGS rejects -> stops workflow and marks following skipped', async () => {
    const contractor = makeIdentity(fixture.contractorUser);
    const supervisor = makeIdentity(fixture.supervisorUser);
    const correlationId = randomUUID();

    // 1. Create acceptance record
    const accCode = `NT-REJ-${randomUUID().slice(0, 8)}`;
    const accRecord = (await qualityService.createAcceptanceRecord(
      contractor,
      fixture.projectId,
      {
        code: accCode,
        record_type: 'work_acceptance',
      },
      correlationId,
    )) as { id: string };

    // 2. Init sessions
    const initRes = (await signingService.initSigningSessions(
      contractor,
      fixture.projectId,
      {
        signableType: 'acceptance_record',
        signableId: accRecord.id,
        signers: [
          { signingOrder: 1, role: 'contractor_rep', userId: fixture.contractorUser },
          { signingOrder: 2, role: 'tvgs_lead', userId: fixture.supervisorUser },
          { signingOrder: 3, role: 'pmu_manager', userId: fixture.pmuUser },
        ],
      },
      correlationId,
    )) as { sessions: Array<{ id: string }> };

    const [s1, s2, s3] = initRes.sessions;

    // Step 1 signs
    await signingService.authorizeSession(contractor, fixture.projectId, s1!.id, {}, correlationId);
    await signingService.signSession(
      contractor,
      fixture.projectId,
      s1!.id,
      { otpCode: '111111' },
      correlationId,
    );

    // Step 2 Rejects
    const rejectRes = (await signingService.rejectSession(
      supervisor,
      fixture.projectId,
      s2!.id,
      { reason: 'Cao độ móng trục C-2 sai lệch vượt tiêu chuẩn cho phép 20mm' },
      correlationId,
    )) as { status: string; actionNotice: string };

    expect(rejectRes.status).toBe('rejected');
    expect(rejectRes.actionNotice).toBeDefined();

    // Verify session 2 is rejected and session 3 is skipped
    const s2Check = await pool.query<{ status: string; rejection_reason: string }>(
      'SELECT status, rejection_reason FROM vinops.signature_sessions WHERE id = $1',
      [s2!.id],
    );
    expect(s2Check.rows[0]?.status).toBe('rejected');
    expect(s2Check.rows[0]?.rejection_reason).toContain('Cao độ móng trục C-2');

    const s3Check = await pool.query<{ status: string }>(
      'SELECT status FROM vinops.signature_sessions WHERE id = $1',
      [s3!.id],
    );
    expect(s3Check.rows[0]?.status).toBe('skipped');

    // Verify acceptance record is Rejected
    const accCheck = await pool.query<{ status: string }>(
      'SELECT status FROM vinops.acceptance_records WHERE id = $1',
      [accRecord.id],
    );
    expect(accCheck.rows[0]?.status).toBe('Rejected');
  });

  it('enforces tenant isolation and signer identity: unauthorized actor cannot sign', async () => {
    const contractor = makeIdentity(fixture.contractorUser);
    const intruder = makeIdentity(fixture.intruderUser);
    const correlationId = randomUUID();

    const accCode = `NT-TENANT-${randomUUID().slice(0, 8)}`;
    const accRecord = (await qualityService.createAcceptanceRecord(
      contractor,
      fixture.projectId,
      { code: accCode, record_type: 'work_acceptance' },
      correlationId,
    )) as { id: string };

    const initRes = (await signingService.initSigningSessions(
      contractor,
      fixture.projectId,
      {
        signableType: 'acceptance_record',
        signableId: accRecord.id,
        signers: [{ signingOrder: 1, role: 'contractor_rep', userId: fixture.contractorUser }],
      },
      correlationId,
    )) as { sessions: Array<{ id: string }> };

    const sessionId = initRes.sessions[0]!.id;

    // Intruder attempts to authorize contractor's session
    await expect(
      signingService.authorizeSession(intruder, fixture.projectId, sessionId, {}, correlationId),
    ).rejects.toThrow('User is not the assigned signer for this step');

    // Cross-project access attempt
    await expect(
      signingService.authorizeSession(
        contractor,
        fixture.otherProjectId,
        sessionId,
        {},
        correlationId,
      ),
    ).rejects.toThrow();
  });

  it('creates and seals as-built dossier with cryptographic hash chain', async () => {
    const pmu = makeIdentity(fixture.pmuUser);
    const correlationId = randomUUID();

    // 1. Create dossier
    const dossierCode = `DOS-${Date.now().toString().slice(-6)}`;
    const dossier = (await signingService.createDossier(
      pmu,
      fixture.projectId,
      {
        code: dossierCode,
        name: 'Hồ sơ Nghiệm thu Giai đoạn Móng',
        dossierType: 'stage_acceptance',
      },
      correlationId,
    )) as { id: string; status: string };

    expect(dossier.id).toBeDefined();
    expect(dossier.status).toBe('assembling');

    // 2. Add dossier items
    // First ensure a dummy file object exists for itemFileId
    const dummyFileId = randomUUID();
    await pool.query(`
      INSERT INTO vinops.file_objects (
        id, organization_id, project_id, storage_provider, storage_bucket, quarantine_object_key,
        available_object_key, original_filename, declared_sha256, actual_sha256,
        declared_size_bytes, actual_size_bytes, declared_media_type, detected_media_type,
        status, available_at, created_by
      ) VALUES (
        '${dummyFileId}', '${fixture.orgId}', '${fixture.projectId}', 's3', 'vinops-files', 'dossier-${dummyFileId}.pdf',
        'dossier-${dummyFileId}.pdf', 'test.pdf', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        1024, 1024, 'application/pdf', 'application/pdf',
        'Available', now(), '${fixture.pmuUser}'
      ) ON CONFLICT (id) DO NOTHING
    `);

    const items = (await signingService.addDossierItems(
      pmu,
      fixture.projectId,
      dossier.id,
      [
        {
          itemType: 'acceptance_record',
          itemEntityId: randomUUID(),
          itemFileId: dummyFileId,
          sequence: 1,
          itemHash: '4a7d1ed414474e4033ac29ccb8653d9b12852eb3e4fb2d77d701aa80c47d337a',
        },
        {
          itemType: 'test_report',
          itemEntityId: randomUUID(),
          itemFileId: dummyFileId,
          sequence: 2,
          itemHash: '5b8e2fe525585f5144bd30ddc9764e0c23963fc4f50c3e88e812bb91d58e448b',
        },
      ],
      correlationId,
    )) as Array<{ sequence: number }>;

    expect(items).toHaveLength(2);

    // 3. Seal dossier
    const sealRes = (await signingService.sealDossier(
      pmu,
      fixture.projectId,
      dossier.id,
      { signingProviderCode: 'viettel_cloud_ca' },
      correlationId,
    )) as {
      status: string;
      sealedHash: string;
      totalItems: number;
      hashChain: Array<{ nodeHash: string }>;
    };

    expect(sealRes.status).toBe('sealed');
    expect(sealRes.totalItems).toBe(2);
    expect(sealRes.sealedHash).toBeDefined();
    expect(sealRes.hashChain).toHaveLength(3); // metadata (0) + 2 items
  });
});
