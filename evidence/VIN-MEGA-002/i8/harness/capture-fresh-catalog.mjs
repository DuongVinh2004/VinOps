import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_i8_test', max: 1, application_name: 'vinops-mega002-i8-fresh-catalog' });
try {
  const policies = await pool.query(`SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'vinops' AND tablename IN ('transmittals','transmittal_items','transmittal_recipients') ORDER BY tablename, policyname`);
  const relations = await pool.query(`SELECT c.oid::regclass::text AS relation, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vinops' AND c.relname IN ('transmittals','transmittal_items','transmittal_recipients') ORDER BY c.relname`);
  await writeFile('evidence/VIN-MEGA-002/i8/I8_FRESH_RLS_CATALOG.json', JSON.stringify({ database: 'vinops_mega002_i8_test', policies: policies.rows, relations: relations.rows }, null, 2));
} finally { await pool.end(); }
