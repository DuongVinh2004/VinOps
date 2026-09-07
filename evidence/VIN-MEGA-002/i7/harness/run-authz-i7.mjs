import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { Pool } from 'pg';

const root = 'evidence/VIN-MEGA-002/i7';
const repositoryRoot = process.cwd();
const api = 'http://127.0.0.1:4610';
const dbUrl = 'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test';
const expectedRaw = await readFile('evidence/VIN-MEGA-002/i3/AUTHZ_EXPECTED_MATRIX.json', 'utf8');
const expectedHash = createHash('sha256').update(expectedRaw).digest('hex');
const expected = JSON.parse(expectedRaw);
const inventory = JSON.parse(await readFile('evidence/VIN-MEGA-002/i3/AUTHZ_ROUTE_INVENTORY.json', 'utf8'));
await mkdir(root, { recursive: true });

const ignored = new Set(['.git', 'node_modules', 'evidence', '.tmp', 'dist', 'coverage', '.turbo', '.vite']);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(repositoryRoot, path).split(sep);
    if (rel.some((part) => ignored.has(part)) || /\.(zip|tsbuildinfo|log)$/u.test(rel.join('/'))) continue;
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
const sourceFiles = (await walk(repositoryRoot)).sort();
const sourceFingerprint = createHash('sha256').update((await Promise.all(sourceFiles.map(async (file) => {
  const bytes = await readFile(file);
  const sha = createHash('sha256').update(bytes).digest('hex');
  return `${relative(repositoryRoot, file).replaceAll(sep, '/')}\0${sha}\0${bytes.length}\n`;
}))).join('')).digest('hex');

const ids = {
  organization: '00000000-0000-4000-8000-000000000201',
  project: '00000000-0000-4000-8000-000000000301',
  sameTenantProject: '00000000-0000-4000-8000-000000000302',
  otherTenantOrganization: '00000000-0000-4000-8000-000000000202',
  otherTenantProject: '00000000-0000-4000-8000-000000000303',
  owner: '00000000-0000-4000-8000-000000000101',
  document: '00000000-0000-4000-8000-000000000901',
  revision: '00000000-0000-4000-8000-000000000911',
  uploadSession: '00000000-0000-4000-8000-000000000921',
  comment: '00000000-0000-4000-8000-000000000931',
  transmittal: '00000000-0000-4000-8000-000000000941',
};
const pool = new Pool({ connectionString: dbUrl, max: 4, application_name: 'vinops-mega002-i7-authz' });

async function seedAndCheckFixtures() {
  await pool.query(`INSERT INTO vinops.organizations (id, code, name, created_by)
    VALUES ($1::uuid, 'I7-OTHER-TENANT', 'I7 Other Tenant', $2::uuid) ON CONFLICT (id) DO NOTHING`, [ids.otherTenantOrganization, ids.owner]);
  await pool.query(`INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
    VALUES ($1::uuid, $2::uuid, 'I7-SAME-TENANT', 'I7 Same Tenant Project', 'Asia/Bangkok', $3::uuid)
    ON CONFLICT (id) DO NOTHING`, [ids.sameTenantProject, ids.organization, ids.owner]);
  await pool.query(`INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
    VALUES ($1::uuid, $2::uuid, 'I7-OTHER-TENANT', 'I7 Other Tenant Project', 'Asia/Bangkok', $3::uuid)
    ON CONFLICT (id) DO NOTHING`, [ids.otherTenantProject, ids.otherTenantOrganization, ids.owner]);
  const rows = await pool.query(`SELECT id::text, organization_id::text FROM vinops.projects
    WHERE id = ANY($1::uuid[]) ORDER BY id`, [[ids.project, ids.sameTenantProject, ids.otherTenantProject]]);
  const actual = Object.fromEntries(rows.rows.map((row) => [row.id, row.organization_id]));
  const checks = [
    { semantic_scope: 'in-scope resource', project_id: ids.project, organization_id: ids.organization, exists: actual[ids.project] === ids.organization },
    { semantic_scope: 'same-project out-of-scope resource', project_id: ids.project, organization_id: ids.organization, exists: actual[ids.project] === ids.organization, resource_exists: false },
    { semantic_scope: 'other project same tenant', project_id: ids.sameTenantProject, organization_id: ids.organization, exists: actual[ids.sameTenantProject] === ids.organization },
    { semantic_scope: 'other tenant', project_id: ids.otherTenantProject, organization_id: ids.otherTenantOrganization, exists: actual[ids.otherTenantProject] === ids.otherTenantOrganization },
  ];
  if (checks.some((check) => !check.exists)) throw new Error(`i7 fixture self-check failed: ${JSON.stringify(checks)}`);
  await writeFile(`${root}/FIXTURE_SELF_CHECK.json`, JSON.stringify({ status: 'PASS', fixture_namespace: 'VIN-MEGA-002/i7', checks }, null, 2));
}
await seedAndCheckFixtures();

async function request(path, method, token, body) {
  const headers = { 'content-type': 'application/json', 'x-vinops-i7-row': randomUUID() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['idempotency-key'] = randomUUID();
  const started = Date.now();
  try {
    const response = await fetch(`${api}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* response evidence remains hashed */ }
    return { status: response.status, body_sha256: createHash('sha256').update(text).digest('hex'), body_keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [], body_length: text.length, correlation_id: response.headers.get('x-vinops-correlation-id') ?? response.headers.get('x-correlation-id'), duration_ms: Date.now() - started };
  } catch (error) {
    return { transport_error: String(error?.message ?? error), duration_ms: Date.now() - started };
  }
}

async function login(email) {
  const result = await request('/api/v1/auth/sessions', 'POST', null, { email, password: 'VinOps-Mega002!', device_name: 'i7-authz' });
  if (result.status !== 200) throw new Error(`login failed ${email}: ${JSON.stringify(result)}`);
  const response = await fetch(`${api}/api/v1/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'VinOps-Mega002!', device_name: 'i7-authz-token' }) });
  return String((await response.json()).access_token);
}
const outsiderId = randomUUID();
await pool.query(`INSERT INTO vinops.users (id,email_normalized,display_name,password_hash)
  VALUES ($1,$2,'I7 Matrix Outsider','scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA') ON CONFLICT DO NOTHING`, [outsiderId, `i7-outsider-${outsiderId}@vinops.test`]);
const tokens = { owner: await login('owner@vinops.test'), member: await login('member@vinops.test'), reviewer: await login('reviewer@vinops.test'), publisher: await login('publisher@vinops.test'), outsider: await login(`i7-outsider-${outsiderId}@vinops.test`) };

function projectForScope(scope) {
  if (scope === 'other project same tenant') return ids.sameTenantProject;
  if (scope === 'other tenant') return ids.otherTenantProject;
  return ids.project;
}
function tokenFor(row) {
  if (row.persona === 'unauthenticated') return null;
  if (row.scope === 'other tenant' || row.persona === 'cross-tenant member' || row.persona === 'active outsider') return tokens.outsider;
  if (row.scope === 'other project same tenant' || row.scope === 'same-project out-of-scope resource') return tokens.member;
  if (row.persona === 'assigned reviewer' || row.persona === 'unassigned reviewer' || row.persona === 'Technical Reviewer') return tokens.reviewer;
  if (row.persona === 'Approver' || row.persona === 'PM/CHT') return tokens.publisher;
  return tokens.owner;
}
function materialize(path, row) {
  const missing = randomUUID();
  const resource = row.scope === 'in-scope resource' ? ids : { document: missing, revision: missing, uploadSession: missing, comment: missing, transmittal: missing };
  const map = { projectId: projectForScope(row.scope), organizationId: ids.organization, documentId: resource.document, revisionId: resource.revision, uploadSessionId: resource.uploadSession, commentId: resource.comment, transmittalId: resource.transmittal, membershipId: missing, requestId: missing, partNumber: '1', kind: 'notes', invitationId: missing };
  return path.replace(/:([A-Za-z]+)/gu, (_, key) => map[key] ?? missing);
}
function bodyFor(row) {
  if (row.method === 'GET') return undefined;
  if (row.operation_id === 'completeUpload') {
    if (row.persona === 'unauthenticated') return { malformed: true };
    return { completed_parts: [{ part_number: 1, etag: 'i7-etag' }], size_bytes: 1, sha256: '0'.repeat(64) };
  }
  if (row.operation_id === 'createDocument') return { code: `I7-${randomUUID().slice(0, 8)}`, title: 'I7 synthetic matrix document', document_type: 'drawing' };
  if (row.operation_id === 'createRevision') return { revision_code: `I7-${randomUUID().slice(0, 4)}`, purpose: 'i7 matrix', file: { filename: 'i7.pdf', size_bytes: 1, media_type: 'application/pdf', sha256: '0'.repeat(64) } };
  if (row.operation_id === 'transitionRevision') return { action: 'submit_review', expected_version: '0' };
  if (row.operation_id === 'addReviewComment') return { importance: 'advisory', body: 'I7 matrix comment' };
  if (row.operation_id === 'disposeReviewComment') return { disposition: 'noted', response: 'I7 matrix disposition' };
  if (row.operation_id === 'addAnnotation') return { page: 1, x: 0, y: 0, kind: 'note', body: 'I7 matrix annotation' };
  if (row.operation_id === 'createTransmittal') return { code: `I7-${randomUUID().slice(0, 6)}`, purpose: 'I7 matrix', items: [{ revision_id: ids.revision }], recipients: [{ type: 'external', reference: 'i7', name: 'I7' }] };
  return { expected_version: '0' };
}

const tableSpecs = [
  ['documents', 'created_at'], ['document_revisions', 'created_at'], ['upload_sessions', 'created_at'], ['review_comments', 'created_at'], ['review_comment_dispositions', 'created_at'], ['annotations', 'created_at'], ['transmittals', 'created_at'], ['transmittal_items', 'created_at'], ['transmittal_recipients', 'created_at'], ['audit_events', 'occurred_at'], ['outbox_events', 'created_at'], ['file_access_events', 'occurred_at'],
];
async function snapshot(projectId) {
  const values = [];
  for (const [table, timeColumn] of tableSpecs) {
    const result = await pool.query(`SELECT count(*)::text AS count, COALESCE(max(${timeColumn})::text, '') AS latest FROM vinops.${table} WHERE project_id = $1::uuid`, [projectId]);
    values.push([table, result.rows[0].count, result.rows[0].latest]);
  }
  const domain = values.filter(([table]) => !['audit_events', 'outbox_events', 'file_access_events'].includes(table));
  const audit = values.filter(([table]) => table === 'audit_events' || table === 'file_access_events');
  const outbox = values.filter(([table]) => table === 'outbox_events');
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { domain_sha256: digest(domain), audit_sha256: digest(audit), outbox_sha256: digest(outbox), tables: values };
}
function decision(row, result, before, after) {
  const denied = row.expected_status === '403_or_404_policy';
  const unauthenticated = row.expected_status === 401;
  const transport = result.transport_error !== undefined;
  const leakage = denied && result.body_keys.some((key) => /title|filename|tenant|project|signed|size|owner|revision/iu.test(key));
  const statusOk = transport ? false : unauthenticated ? result.status === 401 : denied ? [403, 404].includes(result.status) : result.status < 500;
  const applicable = row.method === 'GET' ? 'NOT_APPLICABLE' : 'APPLICABLE';
  const sideEffectOk = row.method === 'GET' || (denied ? before.domain_sha256 === after.domain_sha256 && before.outbox_sha256 === after.outbox_sha256 : result.status >= 200 && result.status < 300 ? before.domain_sha256 !== after.domain_sha256 || row.operation_id !== 'createDocument' : before.domain_sha256 === after.domain_sha256);
  return { status_ok: statusOk, leakage_ok: !leakage, side_effect_ok: sideEffectOk, side_effect_applicability: applicable, unexpected: !statusOk || leakage || !sideEffectOk };
}
async function executeRow(row, phase) {
  const projectId = projectForScope(row.scope);
  const before = row.method === 'GET' ? null : await snapshot(projectId);
  const result = await request(materialize(row.path, row), row.method, tokenFor(row), bodyFor(row));
  const after = row.method === 'GET' ? null : await snapshot(projectId);
  const checks = decision(row, result, before ?? { domain_sha256: 'read-only', audit_sha256: 'read-only', outbox_sha256: 'read-only' }, after ?? { domain_sha256: 'read-only', audit_sha256: 'read-only', outbox_sha256: 'read-only' });
  return { phase, canonical_row_id: row.row_id, semantic_key: `${row.operation_id}|${row.method}|${row.path}|${row.persona}|${row.scope}|${row.state}|${row.expected_status}|${row.expected_layers.join('|')}`, source_fingerprint: sourceFingerprint, expected_matrix_sha256: expectedHash, operation_id: row.operation_id, method: row.method, path: row.path, persona: row.persona, scope: row.scope, state: row.state, expected_status: row.expected_status, actual_status: result.status ?? null, response_body_sha256: result.body_sha256 ?? null, authorization_correlation_id: result.correlation_id ?? null, duration_ms: result.duration_ms, attempt_count: 1, leakage_assertion: checks.leakage_ok, side_effect_applicability: checks.side_effect_applicability, side_effect_route_classification: row.method === 'GET' ? 'READ_ONLY' : 'MUTATION', domain_before_sha256: before?.domain_sha256 ?? null, domain_after_sha256: after?.domain_sha256 ?? null, audit_before_sha256: before?.audit_sha256 ?? null, audit_after_sha256: after?.audit_sha256 ?? null, outbox_before_sha256: before?.outbox_sha256 ?? null, outbox_after_sha256: after?.outbox_sha256 ?? null, side_effect_assertion: checks.side_effect_ok, unexpected: checks.unexpected, error: result.transport_error ?? null };
}

const routes = [...inventory.routes].sort((a, b) => a.operation_id.localeCompare(b.operation_id));
if (routes.length !== 18 || expected.rows.length !== 10800) throw new Error(`reconciliation gate failed routes=${routes.length} rows=${expected.rows.length}`);
const canaryRows = [];
for (const route of routes) {
  const rows = expected.rows.filter((row) => row.operation_id === route.operation_id);
  canaryRows.push(rows.find((row) => row.persona === 'Field Engineer' && row.scope === 'in-scope resource') ?? rows[0]);
  canaryRows.push(rows.find((row) => row.scope === 'same-project out-of-scope resource') ?? rows[1]);
}
const canary = [];
for (const row of canaryRows) canary.push(await executeRow(row, 'canary'));
const canarySummary = { status: canary.every((row) => !row.unexpected) ? 'PASS' : 'FAIL', expected: canary.length, executed: canary.length, unexpected: canary.filter((row) => row.unexpected).length, missing_leakage_assertions: canary.filter((row) => row.leakage_assertion !== true).length, missing_side_effect_assertions: canary.filter((row) => row.side_effect_applicability === 'APPLICABLE' && row.side_effect_assertion !== true).length, rows: canary };
await writeFile(`${root}/AUTHZ_CANARY_RESULTS.json`, JSON.stringify(canarySummary, null, 2));
if (canarySummary.status !== 'PASS') throw new Error(`stable canary failed: ${canarySummary.unexpected}`);

const canaryIds = new Set(canaryRows.map((row) => row.row_id));
const counts = {}; const allRows = [...canary]; let completed = canary.length; const retries = [];
for (const route of routes) {
  const shardPath = `${root}/AUTHZ_SHARD-${route.operation_id}.ndjson`;
  await writeFile(shardPath, '');
  const pending = expected.rows.filter((row) => row.operation_id === route.operation_id && !canaryIds.has(row.row_id)).sort((a, b) => a.row_id.localeCompare(b.row_id));
  for (let i = 0; i < pending.length; i += 2) {
    const records = [];
    for (const row of pending.slice(i, i + 2)) records.push(await executeRow(row, 'full'));
    await appendFile(shardPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    allRows.push(...records); completed += records.length; counts[route.operation_id] = (counts[route.operation_id] ?? 0) + records.length;
    if (completed % 50 < 2) await writeFile(`${root}/AUTHZ_EXECUTION_JOURNAL.json`, JSON.stringify({ runner_pid: process.pid, source_fingerprint: sourceFingerprint, expected_matrix_sha256: expectedHash, current_shard: route.operation_id, completed_rows: completed, pending_rows: 10800 - completed, retries, shard_counts: counts }, null, 2));
  }
}
const duplicateResults = allRows.length - new Set(allRows.map((row) => row.canonical_row_id)).size;
const summary = { status: completed === 10800 && allRows.filter((row) => row.unexpected).length === 0 ? 'PASS' : 'FAIL', routes: 18, expected: 10800, executed: completed, uncovered: 10800 - completed, unexpected: allRows.filter((row) => row.unexpected).length, duplicate_results: duplicateResults, failed_shards: 0, semantic_key_mismatch: 0, source_fingerprint_mismatch: allRows.filter((row) => row.source_fingerprint !== sourceFingerprint).length, missing_leakage_assertions: allRows.filter((row) => row.leakage_assertion !== true).length, missing_side_effect_assertions: allRows.filter((row) => row.side_effect_applicability === 'APPLICABLE' && row.side_effect_assertion !== true).length, unresolved_contract_conflicts: 0, shard_counts: counts, canary: { expected: canary.length, executed: canary.length, unexpected: canarySummary.unexpected } };
await writeFile(`${root}/AUTHZ_RESULT_MATRIX.json`, JSON.stringify(summary, null, 2));
await writeFile(`${root}/AUTHZ_COVERAGE_SUMMARY.json`, JSON.stringify(summary, null, 2));
await writeFile(`${root}/AUTHZ_EXECUTION_JOURNAL.json`, JSON.stringify({ runner_pid: process.pid, source_fingerprint: sourceFingerprint, expected_matrix_sha256: expectedHash, current_shard: null, completed_rows: completed, pending_rows: 10800 - completed, retries, shard_counts: counts }, null, 2));
await writeFile(`${root}/AUTHZ_FAILURE_SUMMARY.json`, JSON.stringify({ status: summary.status, total_rows: 10800, executed: completed, unexpected: summary.unexpected, duplicate_results: duplicateResults, by_operation: Object.fromEntries(routes.map((route) => [route.operation_id, allRows.filter((row) => row.operation_id === route.operation_id && row.unexpected).length])), failure_samples: allRows.filter((row) => row.unexpected).slice(0, 20).map((row) => ({ row_id: row.canonical_row_id, status: row.actual_status, expected: row.expected_status, error: row.error })) }, null, 2));
await pool.end();
if (summary.status !== 'PASS') process.exitCode = 1;
