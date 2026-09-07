import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiRuntimeConfig } from '../src/api-runtime.js';
import type { RequestIdentity } from '../src/platform.service.js';
import { QualityService } from '../src/quality/quality.service.js';
import { DailyLogService } from '../src/records/daily-log.service.js';
import { OfflineSyncService } from '../src/sync/offline-sync.service.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_DATABASE_URL ??
  process.env.VINOPS_TEST_DATABASE_URL ??
  `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat3_test`;

let pool: Pool;
let qualityService: QualityService;
let dailyLogService: DailyLogService;
let offlineSyncService: OfflineSyncService;

const fixture = {
  orgId: '00000000-0000-4000-8000-000000007010',
  projectId: '00000000-0000-4000-8000-000000007020',
  contractPackageId: '00000000-0000-4000-8000-000000007030',
  contractorUser: '00000000-0000-4000-8000-000000007003',
  supervisorUser: '00000000-0000-4000-8000-000000007002',
  pmuUser: '00000000-0000-4000-8000-000000007001',
};

const makeIdentity = (userId: string): RequestIdentity => ({
  userId,
  sessionId: randomUUID(),
  authVersion: 1,
  authorizationVersion: 1,
});

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 2 });

  // Ensure baseline fixture data exists
  await pool.query(`
    INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
    VALUES
      ('${fixture.contractorUser}', 'contractor-api@vinops.test', 'Chỉ huy trưởng CHT', 'hash'),
      ('${fixture.supervisorUser}', 'supervisor-api@vinops.test', 'Kỹ sư TVGS', 'hash'),
      ('${fixture.pmuUser}', 'pmu-api@vinops.test', 'Đại diện Ban QLDA', 'hash')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organizations (id, code, name, created_by)
    VALUES ('${fixture.orgId}', 'ORG-API-Q', 'Tổ chức Nghiệm thu API', '${fixture.pmuUser}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
    VALUES ('${fixture.projectId}', '${fixture.orgId}', 'PRJ-API-Q', 'Dự án Nghiệm thu API', 'Asia/Bangkok', '${fixture.pmuUser}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
    VALUES
      ('${randomUUID()}', '${fixture.orgId}', '${fixture.contractorUser}', ARRAY['member'], 'Active'),
      ('${randomUUID()}', '${fixture.orgId}', '${fixture.supervisorUser}', ARRAY['member'], 'Active'),
      ('${randomUUID()}', '${fixture.orgId}', '${fixture.pmuUser}', ARRAY['organization_owner'], 'Active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
    VALUES
      ('${randomUUID()}', '${fixture.orgId}', '${fixture.projectId}', '${fixture.contractorUser}', ARRAY['contractor'], 'Active', now()),
      ('${randomUUID()}', '${fixture.orgId}', '${fixture.projectId}', '${fixture.supervisorUser}', ARRAY['supervisor'], 'Active', now()),
      ('${randomUUID()}', '${fixture.orgId}', '${fixture.projectId}', '${fixture.pmuUser}', ARRAY['project_admin'], 'Active', now())
    ON CONFLICT (project_id, user_id) DO NOTHING;
  `);

  const mockConfig = { VINOPS_DATABASE_URL: connectionString } as unknown as ApiRuntimeConfig;
  qualityService = new QualityService(mockConfig);
  dailyLogService = new DailyLogService(mockConfig);
  offlineSyncService = new OfflineSyncService(mockConfig);
});

afterAll(async () => {
  await qualityService.onModuleDestroy();
  await dailyLogService.onModuleDestroy();
  await offlineSyncService.onModuleDestroy();
  await pool.end();
});

describe('NĐ 207/2026/NĐ-CP 3-Party Sequential Acceptance Workflow', () => {
  it('enforces sequential signing: Contractor -> Supervisor -> PMU', async () => {
    const contractorId = makeIdentity(fixture.contractorUser);
    const supervisorId = makeIdentity(fixture.supervisorUser);
    const pmuId = makeIdentity(fixture.pmuUser);

    // 1. Create Acceptance Record
    const code = `NT-API-${Date.now().toString().slice(-6)}`;
    const record = (await qualityService.createAcceptanceRecord(
      contractorId,
      fixture.projectId,
      {
        code,
        record_type: 'work_acceptance',
        legal_basis: 'Nghị định 207/2026/NĐ-CP & Thông tư 32/2026/TT-BXD',
        result: 'Accepted',
      },
      randomUUID(),
    )) as { id: string; status: string };

    expect(record.id).toBeDefined();
    expect(record.status).toBe('Draft');

    // 2. Out-of-order rejection: PMU cannot sign Draft
    await expect(
      qualityService.signAcceptancePmu(
        pmuId,
        record.id,
        'data:image/png;base64,sig_pmu',
        randomUUID(),
      ),
    ).rejects.toThrow();

    // 3. Out-of-order rejection: Supervisor cannot sign Draft
    await expect(
      qualityService.signAcceptanceSupervisor(
        supervisorId,
        record.id,
        'data:image/png;base64,sig_tvgs',
        randomUUID(),
      ),
    ).rejects.toThrow();

    // 4. Contractor signs successfully
    const afterContractor = (await qualityService.signAcceptanceContractor(
      contractorId,
      record.id,
      'data:image/png;base64,sig_contractor',
      randomUUID(),
    )) as { status: string; contractor_signed_by: string };
    expect(afterContractor.status).toBe('Contractor Signed');
    expect(afterContractor.contractor_signed_by).toBe(fixture.contractorUser);

    // 5. Out-of-order rejection: PMU cannot sign Contractor Signed
    await expect(
      qualityService.signAcceptancePmu(
        pmuId,
        record.id,
        'data:image/png;base64,sig_pmu',
        randomUUID(),
      ),
    ).rejects.toThrow();

    // 6. Supervisor signs successfully
    const afterSupervisor = (await qualityService.signAcceptanceSupervisor(
      supervisorId,
      record.id,
      'data:image/png;base64,sig_supervisor',
      randomUUID(),
    )) as { status: string; supervisor_signed_by: string };
    expect(afterSupervisor.status).toBe('Supervisor Signed');
    expect(afterSupervisor.supervisor_signed_by).toBe(fixture.supervisorUser);

    // 7. PMU signs successfully -> Completed
    const afterPmu = (await qualityService.signAcceptancePmu(
      pmuId,
      record.id,
      'data:image/png;base64,sig_pmu',
      randomUUID(),
    )) as { status: string; pmu_signed_by: string };
    expect(afterPmu.status).toBe('Completed');
    expect(afterPmu.pmu_signed_by).toBe(fixture.pmuUser);

    // 8. No further signatures permitted once finalized
    await expect(
      qualityService.signAcceptanceContractor(
        contractorId,
        record.id,
        'data:image/png;base64,sig_contractor',
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
});

describe('Corrective Action Request (CAR) Separation of Duties (SoD)', () => {
  it('prevents CAR performer from self-verifying High/Critical findings', async () => {
    const supervisorId = makeIdentity(fixture.supervisorUser);
    const contractorId = makeIdentity(fixture.contractorUser);

    // 1. Create Template & Inspection
    const template = (await qualityService.createTemplate(
      supervisorId,
      fixture.projectId,
      {
        code: `TMPL-${Date.now().toString().slice(-5)}`,
        name: 'Checklist Bê tông dầm sàn',
        checklist_items: [
          { item_key: 'item_1', title: 'Độ sụt bê tông', criterion_type: 'measurement' },
        ],
      },
      randomUUID(),
    )) as { id: string };

    const inspection = (await qualityService.createInspection(
      supervisorId,
      fixture.projectId,
      {
        code: `BB-${randomUUID().slice(0, 8).toUpperCase()}`,
        template_id: template.id,
        title: 'Nghiệm thu đổ bê tông sàn tầng 3',
      },
      randomUUID(),
    )) as { id: string };

    // 2. Create Finding with severity 'High'
    const finding = (await qualityService.createFinding(
      supervisorId,
      inspection.id,
      {
        code: `FND-${randomUUID().slice(0, 8).toUpperCase()}`,
        severity: 'High',
        description: 'Phát hiện rỗ mặt tại vị trí nút khung trục 3-C',
      },
      randomUUID(),
    )) as { id: string; status: string };
    expect(finding.status).toBe('Open');

    // 3. Contractor submits CAR
    await qualityService.submitCorrection(
      contractorId,
      finding.id,
      {
        description: 'Đục tẩy phần bê tông xốp, quét phụ gia kết nối và trám vữa Sika Grout',
      },
      randomUUID(),
    );

    // 4. CAR SoD Violation: Contractor attempts to verify finding -> Rejected
    await expect(
      qualityService.transitionFinding(contractorId, finding.id, { action: 'close' }, randomUUID()),
    ).rejects.toThrow();

    // 5. Independent TVGS verifies finding -> Succeeds
    const closedFinding = (await qualityService.transitionFinding(
      supervisorId,
      finding.id,
      { action: 'close' },
      randomUUID(),
    )) as { status: string };
    expect(closedFinding.status).toBe('Closed');
  });
});

describe('Daily Log Freeze Constraint & GPS Weather Crawl', () => {
  it('enforces 1 log/day/package, attaches weather, and freezes mutations on Confirmation', async () => {
    const contractorId = makeIdentity(fixture.contractorUser);
    const supervisorId = makeIdentity(fixture.supervisorUser);
    const testPackageId = randomUUID();
    const logDate = '2026-06-15';

    // 1. Create Daily Log
    const dailyLog = (await dailyLogService.createDailyLog(
      contractorId,
      fixture.projectId,
      {
        contract_package_id: testPackageId,
        log_date: logDate,
        shift_code: 'day',
        work_summary: 'Thi công cốt thép sàn dầm',
      },
      randomUUID(),
    )) as { id: string; status: string };
    expect(dailyLog.id).toBeDefined();
    expect(dailyLog.status).toBe('Draft');

    // 2. Invariant: Duplicate log for same date & package rejected (409)
    await expect(
      dailyLogService.createDailyLog(
        contractorId,
        fixture.projectId,
        {
          contract_package_id: testPackageId,
          log_date: logDate,
        },
        randomUUID(),
      ),
    ).rejects.toThrow();

    // 3. Save Manpower & Equipment
    await dailyLogService.saveManpower(
      contractorId,
      dailyLog.id,
      [
        { trade_or_subcontractor: 'Thợ cốt thép', headcount: 15, hours_worked: 8 },
        { trade_or_subcontractor: 'Thợ cốp pha', headcount: 10, hours_worked: 8 },
      ],
      randomUUID(),
    );

    await dailyLogService.saveEquipment(
      contractorId,
      dailyLog.id,
      [
        {
          equipment_name: 'Máy bơm bê tông cần 37m',
          quantity: 1,
          operational_status: 'Operational',
        },
        { equipment_name: 'Vận thăng lồng 2 tấn', quantity: 2, operational_status: 'Operational' },
      ],
      randomUUID(),
    );

    // 4. Crawl Weather by GPS (Hanoi coords)
    const withWeather = (await dailyLogService.crawlWeatherByGps(
      contractorId,
      dailyLog.id,
      { lat: 21.0285, lng: 105.8542 },
      randomUUID(),
    )) as { weather: Array<{ time_of_day: string; source: string; temperature_c: number }> };
    expect(withWeather.weather).toBeDefined();
    expect(withWeather.weather.length).toBe(3); // morning, noon, afternoon

    // 5. Site Manager signs
    const afterSiteManager = (await dailyLogService.signSiteManager(
      contractorId,
      dailyLog.id,
      'data:image/png;base64,sig_sm',
      randomUUID(),
    )) as { status: string };
    expect(afterSiteManager.status).toBe('Submitted');

    // 6. Supervisor signs -> Both signed -> Status becomes 'Confirmed' (Frozen)
    const afterSupervisor = (await dailyLogService.signSupervisor(
      supervisorId,
      dailyLog.id,
      'data:image/png;base64,sig_tvgs',
      randomUUID(),
    )) as { status: string };
    expect(afterSupervisor.status).toBe('Confirmed');

    // 7. Invariant: Mutation on frozen daily log rejected
    await expect(
      dailyLogService.updateDailyLog(
        contractorId,
        dailyLog.id,
        { work_summary: 'Sửa đổi bất hợp pháp sau khi đã ký xác nhận' },
        randomUUID(),
      ),
    ).rejects.toThrow();

    // 8. Invariant: Child records mutation on frozen daily log rejected
    await expect(
      dailyLogService.saveManpower(
        contractorId,
        dailyLog.id,
        [{ trade_or_subcontractor: 'Thợ sơn', headcount: 5 }],
        randomUUID(),
      ),
    ).rejects.toThrow();

    await expect(
      dailyLogService.saveEquipment(
        contractorId,
        dailyLog.id,
        [{ equipment_name: 'Cần cẩu tháp', quantity: 1 }],
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
});

describe('Offline Sync Ledger Ingestion', () => {
  it('processes offline batches, applies clean ops, and detects version conflicts', async () => {
    const contractorId = makeIdentity(fixture.contractorUser);
    const deviceId = randomUUID();

    // 1. Ingest clean batch
    const tempLogId = randomUUID();
    const batchResult = (await offlineSyncService.ingestBatch(
      contractorId,
      fixture.projectId,
      {
        device_id: deviceId,
        operations: [
          {
            operation_id: randomUUID(),
            entity_type: 'daily_log',
            entity_temp_id: tempLogId,
            command: 'create',
            base_version: 1,
            payload: {
              contract_package_id: fixture.contractPackageId,
              log_date: `${2050 + Math.floor(Math.random() * 100000)}-07-15`,
              work_summary: 'Nhật ký ngoại tuyến từ thiết bị hiện trường',
            },
            client_created_at: new Date().toISOString(),
          },
        ],
      },
      randomUUID(),
    )) as {
      batch_id: string;
      status: string;
      applied_count: number;
      conflict_count: number;
      operations: Array<{ operation_id: string; status: string; canonical_id?: string }>;
    };

    expect(batchResult.status).toBe('completed');
    expect(batchResult.applied_count).toBe(1);
    expect(batchResult.operations[0]!.status).toBe('applied');
    const createdId = batchResult.operations[0]!.canonical_id;
    expect(createdId).toBeDefined();

    // 2. Fetch changes feed
    const changesFeed = (await offlineSyncService.getChanges(
      contractorId,
      fixture.projectId,
      undefined,
      randomUUID(),
    )) as { changes: Array<{ entity_id: string; entity_type: string }> };
    expect(changesFeed.changes.length).toBeGreaterThan(0);

    // 3. Stale update conflict detection
    const staleResult = (await offlineSyncService.ingestBatch(
      contractorId,
      fixture.projectId,
      {
        device_id: deviceId,
        operations: [
          {
            operation_id: randomUUID(),
            entity_type: 'daily_log',
            entity_temp_id: createdId!,
            command: 'update',
            base_version: 999, // Stale / future version conflict
            payload: { work_summary: 'Xung đột phiên bản' },
            client_created_at: new Date(Date.now() - 3600000).toISOString(),
          },
        ],
      },
      randomUUID(),
    )) as { conflict_count: number; operations: Array<{ status: string }> };

    expect(staleResult.conflict_count).toBe(1);
    expect(staleResult.operations[0]!.status).toBe('conflict');
  });
});
