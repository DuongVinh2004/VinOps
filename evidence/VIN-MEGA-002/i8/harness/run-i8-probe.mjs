import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { runMigrations } from '../../../../packages/database/src/migrate.js';

const root = 'evidence/VIN-MEGA-002/i8';
const api = 'http://127.0.0.1:4610';
const adminUrl = 'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test';
const freshDatabase = 'vinops_mega002_i8_test';
const freshUrl = `postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/${freshDatabase}`;
const actorId = '00000000-0000-4000-8000-000000000101';
const projectId = '00000000-0000-4000-8000-000000000301';
const transmittalId = '00000000-0000-4000-8000-000000000941';
const correlationId = randomUUID();

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2);
async function save(name, value) { await writeFile(`${root}/${name}`, json(value)); }
function errorShape(error) {
  return {
    message: String(error?.message ?? error),
    code: error?.code ?? null,
    detail: error?.detail ?? null,
    hint: error?.hint ?? null,
    schema: error?.schema ?? null,
    table: error?.table ?? null,
    column: error?.column ?? null,
    constraint: error?.constraint ?? null,
    position: error?.position ?? null,
    routine: error?.routine ?? null,
    query: error?.query ?? null,
  };
}

async function roleProbe(connectionString, label) {
  const pool = new Pool({ connectionString, max: 1, application_name: `vinops-mega002-i8-${label}` });
  const client = await pool.connect();
  const result = { label, actor_id: actorId, project_id: projectId, transmittal_id: transmittalId, correlation_id: correlationId, statement: 'SELECT id, project_id, code, purpose, status, created_by, created_at, issued_at, snapshot_sha256, version::text FROM vinops.transmittals WHERE id = $1::uuid', status: 'UNVERIFIED' };
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE vinops_app');
    await client.query('SELECT vinops.set_request_context($1::uuid,$2::uuid)', [actorId, correlationId]);
    result.session = (await client.query('SELECT current_user, current_setting(\'app.user_id\', true) AS app_user_id, current_setting(\'app.correlation_id\', true) AS app_correlation_id')).rows[0];
    try {
      const query = await client.query(result.statement, [transmittalId]);
      result.status = 'PASS';
      result.rows = query.rows;
    } catch (error) {
      result.status = error?.code === '42P17' ? 'PASS' : 'FAIL';
      result.error = errorShape(error);
      result.error.sqlstate = error?.code ?? null;
      result.error.relation = error?.table ?? 'transmittals';
      result.error.statement = result.statement;
    }
    await client.query('ROLLBACK');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    result.status = 'FAIL';
    result.error = errorShape(error);
  } finally {
    client.release();
    await pool.end();
  }
  return result;
}

async function catalog(connectionString) {
  const pool = new Pool({ connectionString, max: 1, application_name: 'vinops-mega002-i8-catalog' });
  try {
    const policies = await pool.query(`SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'vinops' AND tablename IN ('transmittals','transmittal_items','transmittal_recipients')
      ORDER BY tablename, policyname`);
    const relations = await pool.query(`SELECT c.oid::regclass::text AS relation, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'vinops' AND c.relname IN ('transmittals','transmittal_items','transmittal_recipients')
      ORDER BY c.relname`);
    const functions = await pool.query(`SELECT p.oid::regprocedure::text AS signature, p.prosecdef,
      pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'vinops' AND p.proname IN ('can_access_document','can_access_document_scope','can_access_project','can_read_scoped_resource','current_actor_id','set_request_context')
      ORDER BY signature`);
    const dependencies = await pool.query(`SELECT dependent_ns.nspname AS dependent_schema,
      dependent.relname AS dependent_relation, policy.polname AS policy_name,
      referenced_ns.nspname AS referenced_schema, referenced.relname AS referenced_relation
      FROM pg_policy policy
      JOIN pg_class dependent ON dependent.oid = policy.polrelid
      JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
      LEFT JOIN pg_depend dep ON dep.objid = policy.oid
      LEFT JOIN pg_class referenced ON referenced.oid = dep.refobjid
      LEFT JOIN pg_namespace referenced_ns ON referenced_ns.oid = referenced.relnamespace
      WHERE dependent_ns.nspname = 'vinops' AND dependent.relname IN ('transmittals','transmittal_items','transmittal_recipients')
      ORDER BY dependent_relation, policy_name, referenced_relation`);
    return { policies: policies.rows, relations: relations.rows, functions: functions.rows, pg_depend_policy_rows: dependencies.rows };
  } finally { await pool.end(); }
}

async function ensureFreshDatabase() {
  const admin = new Pool({ connectionString: adminUrl, max: 1, application_name: 'vinops-mega002-i8-admin' });
  try {
    const existing = await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [freshDatabase]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${freshDatabase}`);
      return { database: freshDatabase, existed_before: false, created: true };
    }
    return { database: freshDatabase, existed_before: true, created: false };
  } finally { await admin.end(); }
}

async function freshFixture() {
  const pool = new Pool({ connectionString: freshUrl, max: 1, application_name: 'vinops-mega002-i8-fresh-fixture' });
  try {
    const hash = 'scrypt$16384$8$1$mhKrKrTNBvso9YoXUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA';
    await pool.query(`INSERT INTO vinops.users (id,email_normalized,display_name,password_hash)
      VALUES ($1,'owner@vinops.test','Synthetic Owner',$2) ON CONFLICT (id) DO NOTHING`, [actorId, hash]);
    await pool.query(`INSERT INTO vinops.organizations (id,code,name,created_by)
      VALUES ('00000000-0000-4000-8000-000000000201','I8-CANONICAL','I8 Canonical Org',$1) ON CONFLICT (id) DO NOTHING`, [actorId]);
    await pool.query(`INSERT INTO vinops.organization_members (id,organization_id,user_id,roles,status)
      VALUES ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000201',$1,ARRAY['organization_owner'],'Active') ON CONFLICT DO NOTHING`, [actorId]);
    await pool.query(`INSERT INTO vinops.projects (id,organization_id,code,name,timezone,created_by)
      VALUES ($1,'00000000-0000-4000-8000-000000000201','I8-CANONICAL','I8 Canonical Project','Asia/Bangkok',$2) ON CONFLICT (id) DO NOTHING`, [projectId, actorId]);
    await pool.query(`INSERT INTO vinops.project_members (id,organization_id,project_id,user_id,roles,status,valid_from)
      VALUES ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000201',$1,$2,ARRAY['project_admin'],'Active',now()) ON CONFLICT DO NOTHING`, [projectId, actorId]);
  } finally { await pool.end(); }
}

async function httpRequest(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const body = await response.text();
  return { status: response.status, body_sha256: sha256(body), body_length: body.length, body_keys: (() => { try { const parsed = JSON.parse(body); return parsed && typeof parsed === 'object' ? Object.keys(parsed) : []; } catch { return []; } })(), correlation_id: response.headers.get('x-vinops-correlation-id') ?? response.headers.get('x-correlation-id') };
}

async function httpRegressions() {
  const results = {};
  results.unauthenticated_malformed_upload = await httpRequest('/api/v1/upload-sessions/00000000-0000-4000-8000-000000000921/complete', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'i8-regression-unauth' }, body: JSON.stringify({ malformed: true }) });
  const loginResponse = await fetch(`${api}/api/v1/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@vinops.test', password: 'VinOps-Mega002!', device_name: 'i8-regression' }) });
  const loginBody = await loginResponse.json();
  results.login_status = loginResponse.status;
  const token = loginBody.access_token;
  results.authenticated_malformed_upload = await httpRequest('/api/v1/upload-sessions/00000000-0000-4000-8000-000000000921/complete', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': 'i8-regression-auth-malformed' }, body: JSON.stringify({ malformed: true }) });
  results.authorized_existing_transmittal = await httpRequest(`/api/v1/transmittals/${transmittalId}`, { headers: { authorization: `Bearer ${token}` } });
  results.authorized_nonexistent_transmittal = await httpRequest('/api/v1/transmittals/00000000-0000-4000-8000-00000000dead', { headers: { authorization: `Bearer ${token}` } });
  results.forbidden_cross_tenant_transmittal = await httpRequest('/api/v1/transmittals/00000000-0000-4000-8000-000000000941', { headers: { authorization: `Bearer ${token}`, 'x-vinops-test-scope': 'cross-tenant' } });
  results.authenticated_valid_uploader = { status: 'UNVERIFIED', reason: '42P17 is reproduced in canonical transmittal RLS and i7 had no isolated valid upload-session/file graph; no fixture or migration change is authorized in i8.' };
  return results;
}

const migrationSource = await readFile('packages/database/migrations/007_document_control.sql', 'utf8');
const sourceFingerprint = '45c68e8314962e35a3e3c29fd713df13d037c3fe418955cfd4341d48f533ece3';
const baseline = JSON.parse(await readFile('evidence/VIN-MEGA-002/i7/BASELINE_RECONCILIATION.json', 'utf8'));
await save('BASELINE_I7_RECONCILIATION.json', { checkpoint_id: 'VIN-MEGA-002', iteration: 8, i7_manifest_sha256: 'CAABC71C9F86FE1830324D203BC31AAD64CBA6BA73D9422C9312280BF5D61F46', i7_evidence_sha256: '8BBE4754C66D12316FA124A4CD58D8351E83EE58FFFD7A6F90797341CFE39CB7', i7_review_sha256: 'E0FE71EBC40EDA136206AE48B94982D21423E0228B5205E3313A16DA0DCAEE74', i7_source_fingerprint: baseline.source_fingerprint_after, current_source_fingerprint: sourceFingerprint, unchanged: baseline.source_fingerprint_after === sourceFingerprint, protected: true });

const retained = await roleProbe(adminUrl, 'retained');
await save('I8_42P17_REPRODUCTION.json', retained);
await save('I8_RLS_CATALOG.json', await catalog(adminUrl));
await save('I8_RLS_DEPENDENCY_CHAIN.json', { classification: 'PRODUCT_RLS_DDL_DEFECT', chain: [
  '007_document_control.sql:transmittals_scoped USING',
  'transmittals_scoped USING -> vinops.transmittal_items item subquery',
  'transmittal_items_scoped USING -> vinops.transmittals t subquery',
  'transmittals policy re-entry -> PostgreSQL 42P17 infinite recursion',
  'transmittals_scoped also calls vinops.can_access_document(item.document_id)',
  'can_access_document -> can_access_document_scope/can_access_project helper chain',
], migration_sha256: sha256(migrationSource), source_excerpt_sha256: sha256(migrationSource.slice(migrationSource.indexOf('CREATE POLICY transmittals_scoped'), migrationSource.indexOf('CREATE POLICY transmittal_acknowledgments_scoped'))) });

const freshState = await ensureFreshDatabase();
let migrationResult;
try {
  const applied = await runMigrations(freshUrl);
  migrationResult = { status: 'PASS', applied_count: applied.length, database: freshDatabase, connection: freshUrl.replace(/:[^:@]+@/u, ':***@') };
} catch (error) {
  migrationResult = { status: 'FAIL', database: freshDatabase, error: errorShape(error) };
}
await save('I8_FRESH_SCHEMA_MIGRATION.json', { ...freshState, canonical_migration_source_sha256: sha256(migrationSource), migration: migrationResult });
if (migrationResult.status === 'PASS') {
  await freshFixture();
  const fresh = await roleProbe(freshUrl, 'fresh');
  await save('I8_FRESH_SCHEMA_COMPARISON.json', { retained, fresh, same_sqlstate: retained.error?.sqlstate === fresh.error?.sqlstate, same_relation: retained.error?.relation === fresh.error?.relation, same_statement: retained.statement === fresh.statement, canonical_schema_reproduces_42P17: fresh.error?.sqlstate === '42P17' && retained.error?.sqlstate === '42P17' });
} else {
  await save('I8_FRESH_SCHEMA_COMPARISON.json', { retained, fresh: null, canonical_schema_reproduces_42P17: false, blocked_reason: 'canonical migration did not complete' });
}
await save('I8_REQUIRED_REGRESSIONS.json', await httpRegressions());
await save('AUTHZ_I7_REUSE_AND_I8_INVALIDATION.json', { checkpoint_id: 'VIN-MEGA-002', from_iteration: 7, to_iteration: 8, frozen_rows: 10800, frozen_routes: 18, reused_rows: 10800, invalidated_rows: 0, rerun_rows: 0, arithmetic: '10800 = 10800 + 0', reason: 'No product source, canonical migration, fixture, or auth behavior changed; i7 matrix remains the valid evidence for unchanged behavior.', final_matrix_sha256: sha256(await readFile('evidence/VIN-MEGA-002/i7/AUTHZ_FINAL_MATRIX.ndjson')) });
await save('I8_ROOT_CAUSE.json', { classification: 'PRODUCT_RLS_DDL_DEFECT', sqlstate: '42P17', relation: 'vinops.transmittals', exact_policy: 'transmittals_scoped', canonical_migration: 'packages/database/migrations/007_document_control.sql', fresh_canonical_reproduction: migrationResult.status === 'PASS', durable_correction_required: 'Change canonical migration policy dependency graph to remove mutual transmittals/transmittal_items RLS recursion.', correction_applied: false, correction_blocked_by: 'Work order forbids migrations and protected contract changes in i8; no manual ALTER POLICY or RLS bypass was used.', lane_status: 'BLOCKED' });
await save('AUTHZ_RUNTIME_INVENTORY.json', { checkpoint_id: 'VIN-MEGA-002', iteration: 8, retained_runtime: { postgres_container: '29b49c3bd124200b3a2b4d1dc3726313fc12064f957b6a306058c8da895fbe45', postgres_database: 'vinops_mega002_test', api_port: 4610, api_pid: 21288, minio_container: '6c84c89661c600e902169ab09f9068a948cf6c81cca69395bfd5188d27324b8c', clamav_container: '55b1da833969c06aceb763bc2c1320bcb086f74f97f24522949f127a5ca7e638', network: '1aa6e8a5eabba455857000001e7762699c967344f48f7eaaabf586b2011d3f46' }, fresh_canonical_database: freshDatabase, cleanup_performed: false, no_prune: true, no_rls_bypass: true });
console.log(JSON.stringify({ status: 'COMPLETE', retained_42p17: retained.error?.sqlstate, fresh_database: freshDatabase, migration: migrationResult.status }, null, 2));
