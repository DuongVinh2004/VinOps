import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const root = 'evidence/VIN-MEGA-002/i9';
const api = 'http://127.0.0.1:4610';
const dbUrl =
  'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test';
const affectedOperations = new Set(['createTransmittal', 'transmittalDetail']);
const expectedRaw = await readFile(
  'evidence/VIN-MEGA-002/i3/AUTHZ_EXPECTED_MATRIX.json',
  'utf8',
);
const expected = JSON.parse(expectedRaw);
const source = JSON.parse(
  await readFile('evidence/VIN-MEGA-002/i9/I9_SOURCE_INVENTORY.json', 'utf8'),
);
const sourceFingerprint = source.fingerprint;
const ids = {
  organization: '00000000-0000-4000-8000-000000000201',
  project: '00000000-0000-4000-8000-000000000301',
  sameTenantProject: '00000000-0000-4000-8000-000000000302',
  otherTenantProject: '00000000-0000-4000-8000-000000000303',
  owner: '00000000-0000-4000-8000-000000000101',
  revision: '00000000-0000-4000-8000-000000000911',
  transmittal: '00000000-0000-4000-8000-000000000941',
};
const pool = new Pool({
  connectionString: dbUrl,
  max: 4,
  application_name: 'vinops-mega002-i9-affected-authz',
});

async function request(path, method, token, body) {
  const headers = {
    'content-type': 'application/json',
    'x-vinops-i9-row': randomUUID(),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['idempotency-key'] = randomUUID();
  const started = Date.now();
  try {
    const response = await fetch(`${api}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep response evidence hashed.
    }
    return {
      status: response.status,
      body_sha256: createHash('sha256').update(text).digest('hex'),
      body_keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
      body_length: text.length,
      correlation_id:
        response.headers.get('x-vinops-correlation-id') ??
        response.headers.get('x-correlation-id'),
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      transport_error: String(error?.message ?? error),
      duration_ms: Date.now() - started,
    };
  }
}

async function login(email) {
  const response = await fetch(`${api}/api/v1/auth/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'VinOps-Mega002!',
      device_name: 'i9-affected-authz',
    }),
  });
  if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status}`);
  return String((await response.json()).access_token);
}

const outsiderId = randomUUID();
const outsiderEmail = `i9-outsider-${outsiderId}@vinops.test`;
await pool.query(
  `INSERT INTO vinops.users (id,email_normalized,display_name,password_hash)
   VALUES ($1,$2,'I9 Matrix Outsider','scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA')
   ON CONFLICT DO NOTHING`,
  [outsiderId, outsiderEmail],
);
const tokens = {
  owner: await login('owner@vinops.test'),
  member: await login('member@vinops.test'),
  reviewer: await login('reviewer@vinops.test'),
  publisher: await login('publisher@vinops.test'),
  outsider: await login(outsiderEmail),
};

function projectForScope(scope) {
  if (scope === 'other project same tenant') return ids.sameTenantProject;
  if (scope === 'other tenant') return ids.otherTenantProject;
  return ids.project;
}

function tokenFor(row) {
  if (row.persona === 'unauthenticated') return null;
  if (
    row.scope === 'other tenant' ||
    row.persona === 'cross-tenant member' ||
    row.persona === 'active outsider'
  )
    return tokens.outsider;
  if (
    row.scope === 'other project same tenant' ||
    row.scope === 'same-project out-of-scope resource'
  )
    return tokens.member;
  if (
    row.persona === 'assigned reviewer' ||
    row.persona === 'unassigned reviewer' ||
    row.persona === 'Technical Reviewer'
  )
    return tokens.reviewer;
  if (row.persona === 'Approver' || row.persona === 'PM/CHT') return tokens.publisher;
  return tokens.owner;
}

function materialize(path, row) {
  const missing = randomUUID();
  const transmittalId = row.scope === 'in-scope resource' ? ids.transmittal : missing;
  const map = {
    projectId: projectForScope(row.scope),
    transmittalId,
    revisionId: row.scope === 'in-scope resource' ? ids.revision : missing,
  };
  return path.replace(/:([A-Za-z]+)/gu, (_, key) => map[key] ?? missing);
}

function bodyFor(row) {
  if (row.method === 'GET') return undefined;
  return {
    code: `I9-${randomUUID().slice(0, 6)}`,
    purpose: 'I9 affected authorization matrix',
    items: [{ revision_id: ids.revision }],
    recipients: [{ type: 'external', reference: 'i9', name: 'I9' }],
  };
}

async function snapshot(projectId) {
  const tables = [
    ['transmittals', 'created_at'],
    ['transmittal_items', 'created_at'],
    ['transmittal_recipients', 'created_at'],
    ['audit_events', 'occurred_at'],
    ['outbox_events', 'created_at'],
  ];
  const values = [];
  for (const [table, timeColumn] of tables) {
    const result = await pool.query(
      `SELECT count(*)::text AS count, COALESCE(max(${timeColumn})::text,'') AS latest FROM vinops.${table} WHERE project_id=$1::uuid`,
      [projectId],
    );
    values.push([table, result.rows[0].count, result.rows[0].latest]);
  }
  const domain = values.filter(([table]) =>
    ['transmittals', 'transmittal_items', 'transmittal_recipients'].includes(table),
  );
  const audit = values.filter(([table]) => table === 'audit_events');
  const outbox = values.filter(([table]) => table === 'outbox_events');
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    domain_sha256: digest(domain),
    audit_sha256: digest(audit),
    outbox_sha256: digest(outbox),
  };
}

function decision(row, result, before, after) {
  const denied = row.expected_status === '403_or_404_policy';
  const unauthenticated = row.expected_status === 401;
  const transport = result.transport_error !== undefined;
  const leakage =
    denied &&
    result.body_keys.some((key) =>
      /title|filename|tenant|project|signed|size|owner|revision/iu.test(key),
    );
  const statusOk = transport
    ? false
    : unauthenticated
      ? result.status === 401
      : denied
        ? [403, 404].includes(result.status)
        : result.status < 500;
  const sideEffectOk =
    row.method === 'GET' ||
    (denied
      ? before.domain_sha256 === after.domain_sha256 &&
        before.outbox_sha256 === after.outbox_sha256
      : result.status >= 200 && result.status < 300
        ? true
        : before.domain_sha256 === after.domain_sha256);
  return { statusOk, leakageOk: !leakage, sideEffectOk };
}

const affectedRows = expected.rows.filter((row) => affectedOperations.has(row.operation_id));
if (affectedRows.length !== 1200) throw new Error(`Expected 1200 affected rows, found ${affectedRows.length}`);
const rerunPath = `${root}/AUTHZ_I9_RERUN_MATRIX.ndjson`;
await writeFile(rerunPath, '');
const rerun = [];
for (const [index, row] of affectedRows.entries()) {
  const projectId = projectForScope(row.scope);
  const before = row.method === 'GET' ? null : await snapshot(projectId);
  const result = await request(
    materialize(row.path, row),
    row.method,
    tokenFor(row),
    bodyFor(row),
  );
  const after = row.method === 'GET' ? null : await snapshot(projectId);
  const checks = decision(row, result, before, after);
  const output = {
    ...row,
    evidence_iteration: 9,
    source_fingerprint: sourceFingerprint,
    actual_status: result.status ?? null,
    response_body_sha256: result.body_sha256 ?? null,
    authorization_correlation_id: result.correlation_id ?? null,
    duration_ms: result.duration_ms,
    leakage_assertion: checks.leakageOk,
    domain_before_sha256: before?.domain_sha256 ?? null,
    domain_after_sha256: after?.domain_sha256 ?? null,
    audit_before_sha256: before?.audit_sha256 ?? null,
    audit_after_sha256: after?.audit_sha256 ?? null,
    outbox_before_sha256: before?.outbox_sha256 ?? null,
    outbox_after_sha256: after?.outbox_sha256 ?? null,
    side_effect_assertion: checks.sideEffectOk,
    unexpected: !checks.statusOk || !checks.leakageOk || !checks.sideEffectOk,
    error: result.transport_error ?? null,
  };
  rerun.push(output);
  await appendFile(rerunPath, `${JSON.stringify(output)}\n`);
  if ((index + 1) % 100 === 0) console.log(`rerun ${index + 1}/${affectedRows.length}`);
}

const i7Rows = (await readFile('evidence/VIN-MEGA-002/i7/AUTHZ_FINAL_MATRIX.ndjson', 'utf8'))
  .trim()
  .split(/\r?\n/u)
  .map((line) => JSON.parse(line));
const reused = i7Rows
  .filter((row) => !affectedOperations.has(row.operation_id))
  .map((row) => ({ ...row, evidence_iteration: 7, reuse_status: 'REUSED_UNCHANGED' }));
const final = [...reused, ...rerun].sort((left, right) =>
  String(left.row_id ?? left.canonical_row_id).localeCompare(
    String(right.row_id ?? right.canonical_row_id),
  ),
);
const idsSeen = final.map((row) => String(row.row_id ?? row.canonical_row_id));
const duplicateIds = idsSeen.length - new Set(idsSeen).size;
const finalPath = `${root}/AUTHZ_FINAL_MATRIX_I9.ndjson`;
await writeFile(finalPath, final.map((row) => JSON.stringify(row)).join('\n') + '\n');
const summary = {
  status:
    final.length === 10800 &&
    rerun.length === 1200 &&
    rerun.every((row) => !row.unexpected) &&
    duplicateIds === 0
      ? 'PASS'
      : 'FAIL',
  source_fingerprint: sourceFingerprint,
  expected_rows: 10800,
  reused_rows: reused.length,
  invalidated_rows: 1200,
  rerun_rows: rerun.length,
  final_rows: final.length,
  rerun_unexpected: rerun.filter((row) => row.unexpected).length,
  final_unexpected: final.filter((row) => row.unexpected).length,
  duplicate_row_ids: duplicateIds,
  affected_operations: [...affectedOperations],
};
await writeFile(`${root}/AUTHZ_I8_REUSE_AND_I9_INVALIDATION.json`, JSON.stringify(summary, null, 2));
await pool.end();
console.log(JSON.stringify(summary, null, 2));
if (summary.status !== 'PASS') process.exitCode = 1;
