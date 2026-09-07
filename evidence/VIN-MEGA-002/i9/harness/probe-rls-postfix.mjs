import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databases = ['vinops_mega002_test', 'vinops_mega002_i8_test', 'vinops_mega002_i2_test9'];
const results = [];
for (const database of databases) {
  const pool = new Pool({
    connectionString: `postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/${database}`,
    max: 1,
    application_name: 'vinops-mega002-i9-postfix-probe',
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE vinops_app');
    await client.query('SELECT vinops.set_request_context($1::uuid,$2::uuid)', [
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000999',
    ]);
    const query = await client.query(
      'SELECT id FROM vinops.transmittals WHERE id = $1::uuid',
      ['00000000-0000-4000-8000-000000000941'],
    );
    await client.query('ROLLBACK');
    const policy = await client.query(
      "SELECT qual, with_check FROM pg_policies WHERE schemaname='vinops' AND tablename='transmittal_items' AND policyname='transmittal_items_scoped'",
    );
    results.push({
      database,
      status: 'PASS',
      sqlstate: null,
      rows: query.rowCount,
      policy: policy.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    results.push({
      database,
      status: 'FAIL',
      sqlstate: error?.code ?? null,
      message: String(error?.message ?? error),
    });
  } finally {
    client.release();
    await pool.end();
  }
}
await writeFile(
  'evidence/VIN-MEGA-002/i9/RLS_POSTFIX_PROBE.json',
  JSON.stringify({ classification: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL', results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
