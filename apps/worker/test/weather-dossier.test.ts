import { createHash, randomUUID } from 'node:crypto';
import { VinopsDatabase } from '@vinops/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WeatherIngestionWorker,
  simulateWeatherForCoordinates,
} from '../src/weather-ingestion-worker.js';
import { AsBuiltDossierBundler, buildZipArchive } from '../src/as-built-dossier-bundler.js';

const dbUser = 'postgres';
const dbAuth = `${dbUser}:${dbUser}`;
const connectionString =
  process.env.VINOPS_DATABASE_URL ??
  process.env.VINOPS_TEST_DATABASE_URL ??
  `postgresql://${dbAuth}@127.0.0.1:5432/vinops_chat3_test`;

const mockLogger = {
  debug: () => {},
  info: () => {},
  error: () => {},
};

let pool: Pool;
let database: VinopsDatabase;
let weatherWorker: WeatherIngestionWorker;
let dossierBundler: AsBuiltDossierBundler;

const fixture = {
  orgId: '00000000-0000-4000-8000-000000007010',
  projectId: '00000000-0000-4000-8000-000000007020',
  contractPackageId: '00000000-0000-4000-8000-000000007030',
  userId: '00000000-0000-4000-8000-000000007001',
};

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 2 });
  database = new VinopsDatabase({
    connectionString,
    applicationName: 'vinops-worker-test',
    runtimeRole: 'vinops_app', // Use vinops_app for test setup queries
  });

  weatherWorker = new WeatherIngestionWorker(database, mockLogger, fixture.userId);
  dossierBundler = new AsBuiltDossierBundler(database, mockLogger, fixture.userId);

  await pool.query(`
    INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
    VALUES ('${fixture.userId}', 'weather-dossier-user@vinops.test', 'Weather User', 'hash')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.organizations (id, code, name, created_by)
    VALUES ('${fixture.orgId}', 'ORG-WD', 'Weather Org', '${fixture.userId}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
    VALUES ('${fixture.projectId}', '${fixture.orgId}', 'PRJ-WD', 'Weather Project', 'Asia/Bangkok', '${fixture.userId}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.acceptance_records (
      id, organization_id, project_id, code, record_type, result, status, created_by
    ) VALUES (
      '${randomUUID()}', '${fixture.orgId}', '${fixture.projectId}', 'BB-NT-WD-01', 'work_acceptance', 'Accepted', 'Completed', '${fixture.userId}'
    ) ON CONFLICT (project_id, code) DO NOTHING;
  `);
});

afterAll(async () => {
  await database.close();
  await pool.end();
});

describe('Weather Ingestion Worker', () => {
  it('simulates accurate weather for GPS coordinates across 3 time windows', () => {
    const morning = simulateWeatherForCoordinates(21.0285, 105.8542, 'morning');
    expect(morning.time_of_day).toBe('morning');
    expect(morning.weather_condition).toBe('Sunny');
    expect(morning.temperature_c).toBeGreaterThan(20);

    const noon = simulateWeatherForCoordinates(21.0285, 105.8542, 'noon');
    expect(noon.time_of_day).toBe('noon');
    expect(noon.temperature_c).toBeGreaterThan(morning.temperature_c);

    const afternoon = simulateWeatherForCoordinates(21.0285, 105.8542, 'afternoon');
    expect(afternoon.time_of_day).toBe('afternoon');
    expect(afternoon.rainfall_mm).toBeGreaterThanOrEqual(0);

    // Rejects invalid coordinates
    expect(() => simulateWeatherForCoordinates(999, 105.8542, 'morning')).toThrow();
  });

  it('ingests weather into database for an active daily log', async () => {
    const logId = randomUUID();
    const date = `${2050 + Math.floor(Math.random() * 100000)}-08-15`;

    // Create a daily log to crawl weather for
    await pool.query(
      `INSERT INTO vinops.daily_logs (
        id, organization_id, project_id, contract_package_id, log_date, shift_code, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, 'day', 'Draft', $6)`,
      [logId, fixture.orgId, fixture.projectId, fixture.contractPackageId, date, fixture.userId],
    );

    const results = await weatherWorker.ingestForDailyLog(logId, { lat: 21.0285, lng: 105.8542 });
    expect(results.length).toBe(3);

    // Verify stored in DB
    const res = await pool.query<{ time_of_day: string; source: string; temperature_c: number }>(
      'SELECT time_of_day, source, temperature_c FROM vinops.daily_weather WHERE daily_log_id = $1 ORDER BY time_of_day',
      [logId],
    );
    expect(res.rows.length).toBe(3);
    expect(res.rows.every((r) => r.source === 'crawled')).toBe(true);
  });
});

describe('As-Built Dossier Bundler', () => {
  it('builds standard PKZIP archive with valid magic bytes and sha256 checksum', () => {
    const files = [
      { name: 'manifest.json', content: JSON.stringify({ version: '1.0' }) },
      { name: 'docs/acceptance.txt', content: 'Bien ban nghiem thu cong trinh' },
    ];

    const zip = buildZipArchive(files);
    expect(zip.length).toBeGreaterThan(0);

    // Check PK\x03\x04 signature
    expect(zip[0]).toBe(0x50); // 'P'
    expect(zip[1]).toBe(0x4b); // 'K'
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);

    const sha256 = createHash('sha256').update(zip).digest('hex');
    expect(sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('compiles and bundles full as-built dossier with manifest and sha256', async () => {
    const result = await dossierBundler.bundleDossier(fixture.projectId, {
      contractPackageId: fixture.contractPackageId,
    });

    expect(result.dossierId).toBeDefined();
    expect(result.zipBuffer.length).toBeGreaterThan(100);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.manifest.legal_basis).toContain('207/2026/NĐ-CP');
    expect(result.manifest.summary.acceptance_records_count).toBeGreaterThanOrEqual(1);
    expect(result.manifest.files.length).toBeGreaterThanOrEqual(4);
  });
});
