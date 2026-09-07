import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

const api = 'http://127.0.0.1:4610/api/v1';
const pool = new Pool({
  connectionString:
    'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test',
  max: 1,
});
const raw = JSON.parse(
  await readFile('evidence/VIN-MEGA-002/i11/AC06_UPLOAD_PERFORMANCE_RAW.json', 'utf8'),
);
const fixture = raw.rounds[1].uploads[0];
const transmittalId = randomUUID();
const organizationId = '00000000-0000-4000-8000-000000000201';
const projectId = '00000000-0000-4000-8000-000000000301';
const ownerId = '00000000-0000-4000-8000-000000000101';
const password = process.env.VINOPS_TEST_PASSWORD ?? ['VinOps', 'Mega002!'].join('-');

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Evidence uses status and response hash for non-JSON bodies.
  }
  return {
    status: response.status,
    body,
    body_sha256: createHash('sha256').update(text).digest('hex'),
  };
}

async function login(email) {
  const result = await request('/auth/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device_name: 'i11-canary' }),
  });
  if (result.status !== 200) throw new Error(`LOGIN_${result.status}`);
  return result.body.access_token;
}

await pool.query(
  `INSERT INTO vinops.transmittals
    (id,organization_id,project_id,code,purpose,status,created_by,issued_at,snapshot_sha256)
   VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'i11 auth canary','Issued',$5::uuid,now(),$6)`,
  [transmittalId, organizationId, projectId, `I11-TR-${transmittalId.slice(0, 8)}`, ownerId, 'd'.repeat(64)],
);
await pool.query(
  `INSERT INTO vinops.transmittal_items
    (id,organization_id,project_id,transmittal_id,document_id,revision_id,context_key,
     document_code_snapshot,document_title_snapshot,revision_code_snapshot,file_sha256_snapshot)
   VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'default',
     'I11-CANARY','I11 Canary','P01',$7)`,
  [randomUUID(), organizationId, projectId, transmittalId, fixture.documentId, fixture.revisionId, raw.environment.payload_sha256],
);
const owner = await login('owner@vinops.test');
const outsider = await login('member@vinops.test');
const auth = (token) => ({ authorization: `Bearer ${token}` });
const existing = await request(`/transmittals/${transmittalId}`, { headers: auth(owner) });
const missing = await request(`/transmittals/${randomUUID()}`, { headers: auth(owner) });
const forbidden = await request(`/transmittals/${transmittalId}`, { headers: auth(outsider) });
const result = {
  status:
    existing.status === 200 &&
    missing.status === 404 &&
    forbidden.status === 404 &&
    !Object.keys(forbidden.body ?? {}).some((key) =>
      /title|filename|tenant|project|signed|size|owner|revision|url/iu.test(key),
    )
      ? 'PASS'
      : 'FAIL',
  transmittal_id: transmittalId,
  authorized_existing: existing,
  authorized_missing: missing,
  forbidden_cross_tenant: forbidden,
};
await pool.end();
await writeFile(
  'evidence/VIN-MEGA-002/i11/I11_AUTHORIZATION_CANARIES.json',
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ status: result.status, statuses: [existing.status, missing.status, forbidden.status] }));
if (result.status !== 'PASS') process.exitCode = 1;
