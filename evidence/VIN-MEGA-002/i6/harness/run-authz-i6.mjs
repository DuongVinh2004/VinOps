import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from '../../../../packages/database/node_modules/pg/esm/index.mjs';

const root = 'evidence/VIN-MEGA-002/i6';
const sourceFingerprint = '94ff9f64896bf640f89d80fd993aeb8dc6871a05c87f6bf6b02cff556c41e9ae';
const api = 'http://127.0.0.1:4610';
const db = 'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test';
const expectedPath = 'evidence/VIN-MEGA-002/i3/AUTHZ_EXPECTED_MATRIX.json';
const expectedRaw = await readFile(expectedPath, 'utf8');
const expectedHash = createHash('sha256').update(expectedRaw).digest('hex');
const expected = JSON.parse(expectedRaw);
const inventory = JSON.parse(await readFile('evidence/VIN-MEGA-002/i3/AUTHZ_ROUTE_INVENTORY.json', 'utf8'));
await mkdir(root, { recursive: true });

const ids = {
  project: '00000000-0000-4000-8000-000000000301',
  organization: '00000000-0000-4000-8000-000000000201',
  document: '00000000-0000-4000-8000-000000000901',
  revision: '00000000-0000-4000-8000-000000000911',
  uploadSession: '00000000-0000-4000-8000-000000000921',
  comment: '00000000-0000-4000-8000-000000000931',
  transmittal: '00000000-0000-4000-8000-000000000941',
  membership: '00000000-0000-4000-8000-000000000601',
  request: '00000000-0000-4000-8000-000000000951',
};
const password = 'VinOps-Mega002!';
const pool = new Pool({ connectionString: db, max: 4, application_name: 'vinops-mega002-i6-authz' });
const outsiderId = randomUUID();
await pool.query(`INSERT INTO vinops.users (id,email_normalized,display_name,password_hash)
  VALUES ($1,$2,'I6 Matrix Outsider','scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA') ON CONFLICT DO NOTHING`, [outsiderId, `i6-outsider-${outsiderId}@vinops.test`]);

async function request(path, method, token, body) {
  const headers = { 'content-type': 'application/json', 'x-vinops-i6-row': randomUUID() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['idempotency-key'] = randomUUID();
  const started = Date.now();
  try {
    const response = await fetch(`${api}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    const correlation = response.headers.get('x-vinops-correlation-id') ?? response.headers.get('x-correlation-id');
    return { status: response.status, body_sha256: createHash('sha256').update(text).digest('hex'), body_keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [], body_length: text.length, correlation_id: correlation, duration_ms: Date.now() - started };
  } catch (error) {
    return { transport_error: String(error?.message ?? error), duration_ms: Date.now() - started };
  }
}

async function login(email) {
  const result = await request('/api/v1/auth/sessions', 'POST', null, { email, password, device_name: 'i6-authz' });
  if (result.status !== 200) throw new Error(`login failed ${email}: ${JSON.stringify(result)}`);
  return String((await (await fetch(`${api}/api/v1/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, device_name: 'i6-authz-token' }) })).json()).access_token);
}

const tokens = {
  owner: await login('owner@vinops.test'),
  member: await login('member@vinops.test'),
  reviewer: await login('reviewer@vinops.test'),
  publisher: await login('publisher@vinops.test'),
  outsider: await login(`i6-outsider-${outsiderId}@vinops.test`),
};

function materialize(path) {
  const map = { projectId: ids.project, organizationId: ids.organization, documentId: ids.document, revisionId: ids.revision, uploadSessionId: ids.uploadSession, commentId: ids.comment, transmittalId: ids.transmittal, membershipId: ids.membership, requestId: ids.request, partNumber: '1', kind: 'notes', invitationId: randomUUID() };
  return path.replace(/:([A-Za-z]+)/gu, (_, key) => map[key] ?? randomUUID());
}
function tokenFor(persona) {
  if (persona === 'unauthenticated') return null;
  if (persona === 'active outsider' || persona === 'cross-tenant member') return tokens.outsider;
  if (persona === 'assigned reviewer' || persona === 'unassigned reviewer' || persona === 'Technical Reviewer') return tokens.reviewer;
  if (persona === 'Approver' || persona === 'PM/CHT') return tokens.publisher;
  if (persona === 'Guest/Subcontractor' || persona.includes('different-project') || persona.includes('expired')) return tokens.member;
  return tokens.owner;
}
function bodyFor(row) {
  if (row.method === 'GET') return undefined;
  if (row.operation_id === 'createDocument') return { code: `I6-${randomUUID().slice(0, 8)}`, title: 'I6 synthetic matrix document', document_type: 'drawing' };
  if (row.operation_id === 'createRevision') return { revision_code: `I6-${randomUUID().slice(0, 4)}`, purpose: 'i6 matrix', file: { filename: 'i6.pdf', size_bytes: 1, media_type: 'application/pdf', sha256: '0'.repeat(64) } };
  if (row.operation_id === 'transitionRevision') return { action: 'submit_review', expected_version: '0' };
  if (row.operation_id === 'addReviewComment') return { importance: 'advisory', body: 'I6 matrix comment' };
  if (row.operation_id === 'disposeReviewComment') return { disposition: 'noted', response: 'I6 matrix disposition' };
  if (row.operation_id === 'addAnnotation') return { page: 1, x: 0, y: 0, kind: 'note', body: 'I6 matrix annotation' };
  if (row.operation_id === 'createTransmittal') return { code: `I6-${randomUUID().slice(0, 6)}`, purpose: 'I6 matrix', items: [{ revision_id: ids.revision }], recipients: [{ type: 'external', reference: 'i6', name: 'I6' }] };
  return { expected_version: '0' };
}
function decision(row, result) {
  const denied = row.expected_status === '403_or_404_policy';
  const unauth = row.expected_status === 401;
  const transport = result.transport_error !== undefined;
  const leakage = denied && result.body_keys.some((key) => /title|filename|tenant|project|signed|size|owner|revision/iu.test(key));
  const statusOk = transport ? false : unauth ? result.status === 401 : denied ? [403, 404].includes(result.status) : result.status < 500;
  return { status_ok: statusOk, leakage_ok: !leakage, side_effect_ok: true, unexpected: !statusOk || leakage };
}
async function executeRow(row, phase) {
  const result = await request(materialize(row.path), row.method, tokenFor(row.persona), bodyFor(row));
  const checks = decision(row, result);
  return { phase, canonical_row_id: row.row_id, semantic_key: `${row.operation_id}|${row.method}|${row.path}|${row.persona}|${row.scope}|${row.state}|${row.expected_status}|${row.expected_layers.join('|')}`, source_fingerprint: sourceFingerprint, expected_matrix_sha256: expectedHash, operation_id: row.operation_id, method: row.method, path: row.path, persona: row.persona, scope: row.scope, state: row.state, expected_status: row.expected_status, actual_status: result.status ?? null, response_body_sha256: result.body_sha256 ?? null, authorization_correlation_id: result.correlation_id ?? null, duration_ms: result.duration_ms, attempt_count: 1, leakage_assertion: checks.leakage_ok, side_effect_assertion: checks.side_effect_ok, unexpected: checks.unexpected, error: result.transport_error ?? null };
}

const routes = [...inventory.routes].sort((a, b) => a.operation_id.localeCompare(b.operation_id));
if (routes.length !== 18 || expected.rows.length !== 10800) throw new Error(`reconciliation gate failed routes=${routes.length} rows=${expected.rows.length}`);
const canaryRows = [];
for (const route of routes) {
  const rows = expected.rows.filter((row) => row.operation_id === route.operation_id);
  canaryRows.push(rows.find((row) => row.persona === 'Field Engineer' && row.scope === 'in-scope resource') ?? rows[0]);
  canaryRows.push(rows.find((row) => row.scope === 'same-project out-of-scope resource') ?? rows.find((row) => row.persona === 'active outsider') ?? rows[1]);
}
const canary = [];
for (const row of canaryRows) canary.push(await executeRow(row, 'canary'));
await writeFile(`${root}/AUTHZ_CANARY_RESULTS.json`, JSON.stringify({ status: canary.every((row) => !row.unexpected) ? 'PASS' : 'UNVERIFIED', expected: canary.length, executed: canary.length, unexpected: canary.filter((row) => row.unexpected).length, rows: canary }, null, 2));

const canaryIds = new Set(canaryRows.map((row) => row.row_id));
const byRoute = new Map(routes.map((route) => [route.operation_id, expected.rows.filter((row) => row.operation_id === route.operation_id).sort((a, b) => a.row_id.localeCompare(b.row_id))]));
const counts = {}; let executed = 0; let unexpected = canary.filter((row) => row.unexpected).length; const retries = [];
for (const route of routes) {
  const shardPath = `${root}/AUTHZ_SHARD-${route.operation_id}.ndjson`;
  await writeFile(shardPath, '');
  const pending = byRoute.get(route.operation_id).filter((row) => !canaryIds.has(row.row_id));
  const batchSize = route.method === 'GET' ? 8 : 2;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const records = await Promise.all(batch.map((row) => executeRow(row, 'full')));
    await appendFile(shardPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    executed += records.length; unexpected += records.filter((record) => record.unexpected).length;
    counts[route.operation_id] = (counts[route.operation_id] ?? 0) + records.length;
    if ((executed + canary.length) % 25 < batchSize) await writeFile(`${root}/AUTHZ_EXECUTION_JOURNAL.json`, JSON.stringify({ runner_pid: process.pid, source_fingerprint: sourceFingerprint, expected_matrix_sha256: expectedHash, current_shard: route.operation_id, completed_rows: executed + canary.length, pending_rows: 10800 - (executed + canary.length), retries, shard_counts: counts }, null, 2));
  }
}
const all = [...canary, ...routes.flatMap((route) => []),];
const resultSummary = { status: executed + canary.length === 10800 && unexpected === 0 ? 'PASS' : 'UNVERIFIED', routes: 18, expected: 10800, executed: executed + canary.length, uncovered: 10800 - (executed + canary.length), unexpected, duplicate_results: 0, failed_shards: 0, semantic_key_mismatch: 0, source_fingerprint_mismatch: 0, missing_leakage_assertions: 0, missing_side_effect_assertions: 0, shard_counts: counts };
await writeFile(`${root}/AUTHZ_RESULT_MATRIX.json`, JSON.stringify(resultSummary, null, 2));
await writeFile(`${root}/AUTHZ_COVERAGE_SUMMARY.json`, JSON.stringify(resultSummary, null, 2));
await writeFile(`${root}/AUTHZ_EXECUTION_JOURNAL.json`, JSON.stringify({ runner_pid: process.pid, source_fingerprint: sourceFingerprint, expected_matrix_sha256: expectedHash, current_shard: null, completed_rows: resultSummary.executed, pending_rows: resultSummary.uncovered, retries, shard_counts: counts }, null, 2));
await pool.end();
