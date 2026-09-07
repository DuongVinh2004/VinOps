import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

const fixture = JSON.parse(
  await readFile('evidence/VIN-MEGA-002/i9/I9_FIXTURE_IDS.json', 'utf8'),
);
const pool = new Pool({
  connectionString:
    'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_i2_test9',
  max: 1,
  application_name: 'vinops-mega002-i9-worker-poll',
});
let state = null;
for (let attempt = 1; attempt <= 60; attempt += 1) {
  const result = await pool.query(
    `SELECT
      file.status AS file_status, file.failure_code, file.actual_size_bytes::text,
      file.actual_sha256, file.available_object_key,
      job.status AS job_status, job.attempts, job.last_error_code,
      (SELECT count(*)::int FROM vinops.file_scan_results scan WHERE scan.file_id=file.id) AS scan_count,
      (SELECT count(*)::int FROM vinops.file_derivatives derivative WHERE derivative.file_id=file.id) AS derivative_count,
      (SELECT count(*)::int FROM vinops.outbox_events event WHERE event.aggregate_id=file.id) AS outbox_count
     FROM vinops.file_objects file
     LEFT JOIN vinops.file_processing_jobs job ON job.file_id=file.id
     WHERE file.id=$1::uuid`,
    [fixture.valid_file_id],
  );
  state = { attempt, ...result.rows[0] };
  if (state.file_status === 'Available' && state.job_status === 'Completed') break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
await pool.end();
const status =
  state?.file_status === 'Available' &&
  state?.job_status === 'Completed' &&
  state?.scan_count === 1 &&
  state?.derivative_count === 1
    ? 'PASS'
    : 'FAIL';
const evidence = {
  status,
  valid_file_id: fixture.valid_file_id,
  final_state: state,
  final_state_sha256: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
};
await writeFile(
  'evidence/VIN-MEGA-002/i9/WORKER_SCAN_RESULT.json',
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
if (status !== 'PASS') process.exitCode = 1;
