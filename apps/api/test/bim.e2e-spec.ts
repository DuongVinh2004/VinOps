import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiRuntimeConfig } from '../src/api-runtime.js';
import type { RequestIdentity } from '../src/platform.service.js';
import { BimService } from '../src/bim/bim.service.js';
import { PlatformError } from '../src/platform-error.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_DATABASE_URL ??
  process.env.VINOPS_TEST_DATABASE_URL ??
  `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat3_test`;

let pool: Pool;
let bimService: BimService;

const projectA = {
  orgId: '00000000-0000-4000-8000-000000008010',
  projectId: '00000000-0000-4000-8000-000000008020',
  userId: '00000000-0000-4000-8000-000000008001',
  locationId: '00000000-0000-4000-8000-000000008030',
};

const projectB = {
  orgId: '00000000-0000-4000-8000-000000009010',
  projectId: '00000000-0000-4000-8000-000000009020',
  userId: '00000000-0000-4000-8000-000000009001',
};

const makeIdentity = (userId: string): RequestIdentity => ({
  userId,
  sessionId: randomUUID(),
  authVersion: 1,
  authorizationVersion: 1,
});

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 2 });

  // Setup Project A and Project B test fixtures with tenant isolation
  await pool.query(`
    -- Users
    INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
    VALUES
      ('${projectA.userId}', 'bim-user-a@vinops.test', 'Kỹ sư BIM A', 'hash'),
      ('${projectB.userId}', 'bim-user-b@vinops.test', 'Kỹ sư BIM B', 'hash')
    ON CONFLICT (id) DO NOTHING;

    -- Organizations
    INSERT INTO vinops.organizations (id, code, name, created_by)
    VALUES
      ('${projectA.orgId}', 'ORG-BIM-A', 'Tổ chức BIM A', '${projectA.userId}'),
      ('${projectB.orgId}', 'ORG-BIM-B', 'Tổ chức BIM B', '${projectB.userId}')
    ON CONFLICT (id) DO NOTHING;

    -- Projects
    INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
    VALUES
      ('${projectA.projectId}', '${projectA.orgId}', 'PRJ-BIM-A', 'Dự án BIM A', 'Asia/Bangkok', '${projectA.userId}'),
      ('${projectB.projectId}', '${projectB.orgId}', 'PRJ-BIM-B', 'Dự án BIM B', 'Asia/Bangkok', '${projectB.userId}')
    ON CONFLICT (id) DO NOTHING;

    -- Memberships
    INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
    VALUES
      (gen_random_uuid(), '${projectA.orgId}', '${projectA.userId}', ARRAY['organization_owner'], 'Active'),
      (gen_random_uuid(), '${projectB.orgId}', '${projectB.userId}', ARRAY['organization_owner'], 'Active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status)
    VALUES
      ('00000000-0000-4000-8000-000000008040', '${projectA.orgId}', '${projectA.projectId}', '${projectA.userId}', ARRAY['project_admin'], 'Active'),
      ('00000000-0000-4000-8000-000000009040', '${projectB.orgId}', '${projectB.projectId}', '${projectB.userId}', ARRAY['project_admin'], 'Active')
    ON CONFLICT (project_id, user_id) DO NOTHING;

    INSERT INTO vinops.member_scopes (id, organization_id, project_id, project_member_id, scope_type, scope_id, actions)
    VALUES
      (gen_random_uuid(), '${projectA.orgId}', '${projectA.projectId}', '00000000-0000-4000-8000-000000008040', 'project', '${projectA.projectId}', ARRAY['read', 'create', 'update', 'delete', 'review', 'approve']),
      (gen_random_uuid(), '${projectB.orgId}', '${projectB.projectId}', '00000000-0000-4000-8000-000000009040', 'project', '${projectB.projectId}', ARRAY['read', 'create', 'update', 'delete', 'review', 'approve'])
    ON CONFLICT (project_member_id, scope_type, scope_id) DO NOTHING;

    -- Location node for Project A
    INSERT INTO vinops.location_nodes (id, organization_id, project_id, code, name, node_type, created_by)
    VALUES ('${projectA.locationId}', '${projectA.orgId}', '${projectA.projectId}', 'LOC-BIM-01', 'Khu vực Tầng 2', 'floor', '${projectA.userId}')
    ON CONFLICT (id) DO NOTHING;
  `);

  const mockConfig = {
    VINOPS_DATABASE_URL: connectionString,
    VINOPS_S3_BUCKET: 'vinops-files',
    VINOPS_S3_ENDPOINT: 'http://localhost:9000',
  } as unknown as ApiRuntimeConfig;

  bimService = new BimService(mockConfig);
});

afterAll(async () => {
  if (bimService) {
    await bimService.onModuleDestroy();
  }
  await pool.end();
});

describe('BIM API Endpoints & RLS Multi-tenant E2E', () => {
  let createdModelId: string;
  let createdRevisionId: string;
  const modelCode = `BIM-STR-A-${randomUUID().slice(0, 8)}`;
  const testGuid = '3B4c8x$vD7A8mK1_eQ0zW1';

  it('1. Creates a new BIM model and revision with outbox emission', async () => {
    const identityA = makeIdentity(projectA.userId);
    const correlationId = randomUUID();

    const res = await bimService.createModel(
      identityA,
      projectA.projectId,
      {
        code: modelCode,
        name: 'Mô hình Kết cấu Khối A - Tầng 2',
        discipline: 'structural',
        crsEpsg: 3857,
      },
      undefined,
      correlationId,
    );

    expect(res['modelId']).toBeDefined();
    expect(res['code']).toBe(modelCode);
    expect(res['status']).toBe('processing');

    const rev = res['revision'] as Record<string, unknown>;
    expect(rev['revisionNumber']).toBe(1);
    expect(rev['conversionStatus']).toBe('pending');

    createdModelId = String(res['modelId']);
    createdRevisionId = String(rev['revisionId']);
  });

  it('2. Lists BIM models with filters', async () => {
    const identityA = makeIdentity(projectA.userId);
    const correlationId = randomUUID();

    const list = await bimService.listModels(
      identityA,
      projectA.projectId,
      { discipline: 'structural' },
      correlationId,
    );

    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((m) => m['code'] === modelCode);
    expect(found).toBeDefined();
    expect(found?.['name']).toBe('Mô hình Kết cấu Khối A - Tầng 2');
  });

  it('3. Gets BIM model detail and 3D rendering manifest', async () => {
    const identityA = makeIdentity(projectA.userId);
    const correlationId = randomUUID();

    const detail = await bimService.getModel(
      identityA,
      projectA.projectId,
      createdModelId,
      correlationId,
    );
    expect(detail['modelId']).toBe(createdModelId);
    expect(detail['code']).toBe(modelCode);

    const manifest = await bimService.getManifest(
      identityA,
      projectA.projectId,
      createdModelId,
      correlationId,
    );
    expect(manifest['modelId']).toBe(createdModelId);
    expect(manifest['gltfDownloadUrl']).toContain('.glb');
    expect(manifest['spatialTreeUrl']).toContain('.json');
  });

  it('4. Creates and queries spatial element links', async () => {
    const identityA = makeIdentity(projectA.userId);
    const correlationId = randomUUID();

    // Insert an element directly for testing link query
    await pool.query(
      `INSERT INTO vinops.bim_elements (
        id, organization_id, project_id, bim_model_revision_id,
        ifc_guid, ifc_type, name, storey_name, properties, bounding_box, location_node_id
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5, 'IfcBeam', 'Dầm D2-04', 'Tầng 2', '{"Pset_BeamCommon": {"Span": 7500}}'::jsonb, '{}'::jsonb, $6::uuid
      )
      ON CONFLICT (bim_model_revision_id, ifc_guid) DO NOTHING`,
      [
        randomUUID(),
        projectA.orgId,
        projectA.projectId,
        createdRevisionId,
        testGuid,
        projectA.locationId,
      ],
    );

    // Query element by GUID
    const el = await bimService.getElementByGuid(
      identityA,
      projectA.projectId,
      testGuid,
      correlationId,
    );
    expect(el['ifcGuid']).toBe(testGuid);
    expect(el['name']).toBe('Dầm D2-04');

    // Link element with location_node
    const linkRes = await bimService.createElementLink(
      identityA,
      projectA.projectId,
      testGuid,
      {
        modelId: createdModelId,
        entityType: 'location_node',
        entityId: projectA.locationId,
      },
      correlationId,
    );
    expect(linkRes['linkId']).toBeDefined();
    expect(linkRes['entityType']).toBe('location_node');

    // Retrieve links
    const linksList = await bimService.getElementLinks(
      identityA,
      projectA.projectId,
      testGuid,
      correlationId,
    );
    const links = linksList['links'] as Array<Record<string, unknown>>;
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]?.['entityType']).toBe('location_node');
  });

  it('5. Saves and loads BCF viewpoints round-trip', async () => {
    const identityA = makeIdentity(projectA.userId);
    const correlationId = randomUUID();

    const saveRes = await bimService.saveViewpoint(
      identityA,
      projectA.projectId,
      {
        modelId: createdModelId,
        title: 'Góc nhìn kiểm tra nứt dầm D2-04',
        cameraData: {
          type: 'perspective',
          cameraViewPoint: { x: 12.45, y: 9.2, z: 8.75 },
          cameraDirection: { x: -0.707, y: -0.5, z: -0.5 },
          cameraUpVector: { x: 0.0, y: 1.0, z: 0.0 },
          fieldOfView: 60.0,
        },
        clippingPlanes: [
          {
            location: { x: 0.0, y: 8.0, z: 0.0 },
            direction: { x: 0.0, y: -1.0, z: 0.0 },
          },
        ],
        highlightedGuids: [testGuid],
        hiddenGuids: [],
      },
      correlationId,
    );

    expect(saveRes['viewpointId']).toBeDefined();
    const viewpointId = String(saveRes['viewpointId']);

    // List viewpoints
    const vpList = await bimService.listViewpoints(
      identityA,
      projectA.projectId,
      createdModelId,
      correlationId,
    );
    expect(vpList.length).toBeGreaterThanOrEqual(1);
    expect(vpList[0]?.['title']).toBe('Góc nhìn kiểm tra nứt dầm D2-04');

    // Get viewpoint detail
    const vpDetail = await bimService.getViewpoint(
      identityA,
      projectA.projectId,
      viewpointId,
      correlationId,
    );
    expect(vpDetail['id']).toBe(viewpointId);
    expect(vpDetail['title']).toBe('Góc nhìn kiểm tra nứt dầm D2-04');
    expect(vpDetail['highlightedGuids']).toContain(testGuid);
  });

  it('6. Enforces RLS: User from Project B cannot see models from Project A', async () => {
    const identityB = makeIdentity(projectB.userId);
    const correlationId = randomUUID();

    // User B tries to get Model A using Project A ID -> 404 (non-disclosure)
    await expect(
      bimService.getModel(identityB, projectA.projectId, createdModelId, correlationId),
    ).rejects.toThrow(PlatformError);

    // User B tries to get Model A using Project B ID -> 404
    await expect(
      bimService.getModel(identityB, projectB.projectId, createdModelId, correlationId),
    ).rejects.toThrow(PlatformError);

    // User B list models on Project B -> returns empty (no models on Project B)
    const listB = await bimService.listModels(identityB, projectB.projectId, {}, correlationId);
    const foundModelAInProjectB = listB.find((m) => m['id'] === createdModelId);
    expect(foundModelAInProjectB).toBeUndefined();
  });
});
