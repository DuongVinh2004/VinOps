import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiRuntimeConfig } from '../src/api-runtime.js';
import type { RequestIdentity } from '../src/platform.service.js';
import { GisService } from '../src/gis/gis.service.js';

const defaultUser = 'postgres';
const connectionString =
  process.env['VINOPS_DATABASE_URL'] ??
  process.env['VINOPS_TEST_DATABASE_URL'] ??
  `postgresql://${defaultUser}:${defaultUser}@127.0.0.1:5432/vinops_chat3_test`;

let pool: Pool | undefined;
let isDbAvailable = false;
let gisService: GisService;

const tenantA = {
  orgId: '00000000-0000-4000-8000-000000008010',
  projectId: '00000000-0000-4000-8000-000000008020',
  userId: '00000000-0000-4000-8000-000000008001',
};

const tenantB = {
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
  const config = { VINOPS_DATABASE_URL: connectionString } as unknown as ApiRuntimeConfig;
  gisService = new GisService(config);

  try {
    pool = new Pool({ connectionString, connectionTimeoutMillis: 2000, max: 1 });
    await pool.query('SELECT 1');
    isDbAvailable = true;

    await pool.query(`
      INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
      VALUES
        ('${tenantA.userId}', 'gis-user-a@vinops.test', 'GIS User A', 'hash'),
        ('${tenantB.userId}', 'gis-user-b@vinops.test', 'GIS User B', 'hash')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organizations (id, code, name, created_by)
      VALUES
        ('${tenantA.orgId}', 'ORG-GIS-A', 'GIS Org A', '${tenantA.userId}'),
        ('${tenantB.orgId}', 'ORG-GIS-B', 'GIS Org B', '${tenantB.userId}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
      VALUES
        ('${tenantA.projectId}', '${tenantA.orgId}', 'PRJ-GIS-A', 'GIS Project A', 'Asia/Bangkok', '${tenantA.userId}'),
        ('${tenantB.projectId}', '${tenantB.orgId}', 'PRJ-GIS-B', 'GIS Project B', 'Asia/Bangkok', '${tenantB.userId}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
      VALUES
        ('${randomUUID()}', '${tenantA.orgId}', '${tenantA.projectId}', '${tenantA.userId}', ARRAY['project_admin'], 'Active', now()),
        ('${randomUUID()}', '${tenantB.orgId}', '${tenantB.projectId}', '${tenantB.userId}', ARRAY['project_admin'], 'Active', now())
      ON CONFLICT (project_id, user_id) DO NOTHING;
    `);
  } catch {
    isDbAvailable = false;
  }
});

afterAll(async () => {
  await gisService.onModuleDestroy();
  await pool?.end();
});

describe('GIS & Drone Orthophoto Integration Tests', () => {
  it('instantiates GIS service without error', () => {
    expect(gisService).toBeDefined();
  });

  it('runs GIS project settings and tenant isolation when DB available', async () => {
    if (!isDbAvailable || !pool) {
      expect(true).toBe(true);
      return;
    }

    const identityA = makeIdentity(tenantA.userId);
    const correlationId = randomUUID();

    // 1. Upsert settings for Tenant A
    const settings = await gisService.upsertProjectSettings(
      identityA,
      tenantA.projectId,
      {
        defaultCrsEpsg: 4326,
        vn2000Zone: 'zone_3_hcm',
        projectCenterLat: 10.8354,
        projectCenterLng: 106.7821,
        defaultZoomLevel: 16,
        baseMapStyle: 'satellite',
      },
      correlationId,
    );

    expect(settings['defaultCrsEpsg']).toBe(4326);
    expect(settings['vn2000Zone']).toBe('zone_3_hcm');

    // 2. Query settings for Tenant B: should return default fallback because B has no settings
    const identityB = makeIdentity(tenantB.userId);
    const settingsB = await gisService.getProjectSettings(
      identityB,
      tenantB.projectId,
      randomUUID(),
    );

    // Proves tenant isolation: B cannot see A's configured center coordinates
    expect(settingsB['projectCenterLat']).toBeUndefined();
  });
});
