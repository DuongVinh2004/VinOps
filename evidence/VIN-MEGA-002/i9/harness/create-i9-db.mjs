import { mkdir } from 'node:fs/promises';
import { Pool } from 'pg';

await mkdir('evidence/VIN-MEGA-002/i9', { recursive: true });
const database = 'vinops_mega002_i2_test9';
const pool = new Pool({
  connectionString:
    'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test',
  max: 1,
  application_name: 'vinops-mega002-i9-database-bootstrap',
});
try {
  const existing = await pool.query('SELECT datname FROM pg_database WHERE datname = $1', [database]);
  if (existing.rowCount === 0) {
    await pool.query(`CREATE DATABASE ${database}`);
    console.log(JSON.stringify({ database, existed_before: false, created: true }));
  } else {
    console.log(JSON.stringify({ database, existed_before: true, created: false }));
  }
} finally {
  await pool.end();
}
