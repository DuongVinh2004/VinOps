import { createHash } from 'node:crypto';
import { Pool } from 'pg';
const api = 'http://127.0.0.1:4610';
const pool = new Pool({ connectionString: 'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test', max: 1, application_name: 'vinops-mega002-i8-forbidden-http' });
try {
  const user = (await pool.query("SELECT email_normalized FROM vinops.users WHERE email_normalized LIKE 'i7-outsider-%@vinops.test' ORDER BY email_normalized LIMIT 1")).rows[0];
  if (!user) throw new Error('No retained i7 outsider fixture available.');
  const login = await fetch(`${api}/api/v1/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email_normalized, password: 'VinOps-Mega002!', device_name: 'i8-forbidden' }) });
  const loginBody = await login.json();
  const response = await fetch(`${api}/api/v1/transmittals/00000000-0000-4000-8000-000000000941`, { headers: { authorization: `Bearer ${loginBody.access_token}` } });
  const body = await response.text();
  console.log(JSON.stringify({ outsider_email: user.email_normalized, login_status: login.status, request: { method: 'GET', path: '/api/v1/transmittals/00000000-0000-4000-8000-000000000941' }, status: response.status, expected: '403_or_404', result: [403, 404].includes(response.status) ? 'PASS' : 'FAIL', metadata_leakage: /title|filename|tenant|project|signed|size|owner|revision/iu.test(body), body_sha256: createHash('sha256').update(body).digest('hex'), body_length: body.length, correlation_id: response.headers.get('x-vinops-correlation-id') ?? response.headers.get('x-correlation-id') }, null, 2));
} finally { await pool.end(); }
