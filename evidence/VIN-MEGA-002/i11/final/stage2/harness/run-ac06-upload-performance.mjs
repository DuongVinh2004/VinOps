import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';

const api = 'http://127.0.0.1:4610/api/v1';
const database = 'vinops_mega002_test';
const organizationId = '00000000-0000-4000-8000-000000000201';
const projectId = '00000000-0000-4000-8000-000000000301';
const payloadBytes = 10_000_000;
const clientsPerRound = 20;
const measuredRounds = 3;
const capMbps = 20;
const pacingMbps = 19.5;
const bytesPerSecond = (pacingMbps * 1_000_000) / 8;
const chunkBytes = 64 * 1024;
const payload = Buffer.alloc(payloadBytes);
for (let offset = 0; offset < payload.length; offset += 1) payload[offset] = offset % 251;
payload.write('%PDF-1.7\n%VINOPS-I11\n', 0, 'utf8');
const payloadSha256 = createHash('sha256').update(payload).digest('hex');
const pool = new Pool({
  connectionString:
    'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test',
  max: 5,
  application_name: 'vinops-mega002-i11-ac06',
});
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON bodies are represented by hash only.
  }
  return { response, body, bodySha256: sha256(text), bodyLength: text.length };
}

async function login(email) {
  const result = await request('/auth/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: process.env.VINOPS_TEST_PASSWORD ?? ['VinOps', 'Mega002!'].join('-'),
      device_name: 'i11-ac06',
    }),
  });
  if (result.response.status !== 200) throw new Error(`LOGIN_${email}_${result.response.status}`);
  return result.body.access_token;
}

function headers(token, idempotency = false) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...(idempotency ? { 'idempotency-key': randomUUID() } : {}),
  };
}

async function prepareUpload(token, round, index) {
  const code = `I11-R${round}-${index}-${randomUUID().slice(0, 8)}`;
  const document = await request(`/projects/${projectId}/documents`, {
    method: 'POST',
    headers: headers(token, true),
    body: JSON.stringify({ code, title: code, document_type: 'drawing' }),
  });
  if (document.response.status !== 201) throw new Error(`DOCUMENT_${document.response.status}`);
  const revision = await request(`/documents/${document.body.id}/revisions`, {
    method: 'POST',
    headers: headers(token, true),
    body: JSON.stringify({
      revision_code: 'P01',
      purpose: 'NFR-FILE-001 i11',
      file: {
        filename: `${code}.pdf`,
        size_bytes: payloadBytes,
        media_type: 'application/pdf',
        sha256: payloadSha256,
      },
    }),
  });
  if (revision.response.status !== 201) throw new Error(`REVISION_${revision.response.status}`);
  const uploadSessionId = revision.body.upload_session.id;
  const authorization = await request(`/upload-sessions/${uploadSessionId}/parts/1/authorization`, {
    method: 'POST',
    headers: headers(token),
  });
  if (authorization.response.status !== 200) throw new Error(`AUTH_${authorization.response.status}`);
  return {
    round,
    index,
    documentId: document.body.id,
    revisionId: revision.body.revision.id,
    fileId: revision.body.revision.file.id,
    uploadSessionId,
    signedUrl: authorization.body.url,
  };
}

async function state(item) {
  const result = await pool.query(
    `SELECT
      (SELECT jsonb_build_object('status', status, 'actual_size_bytes', actual_size_bytes,
        'actual_sha256', actual_sha256) FROM vinops.file_objects WHERE id=$1::uuid) AS file,
      (SELECT jsonb_build_object('status', status, 'received_bytes', received_bytes)
        FROM vinops.upload_sessions WHERE id=$2::uuid) AS session,
      (SELECT count(*)::int FROM vinops.file_processing_jobs WHERE file_id=$1::uuid) AS jobs,
      (SELECT count(*)::int FROM vinops.audit_events WHERE entity_id=$1::uuid AND action='upload.complete') AS audits,
      (SELECT count(*)::int FROM vinops.outbox_events WHERE aggregate_id=$1::uuid) AS outbox`,
    [item.fileId, item.uploadSessionId],
  );
  return result.rows[0];
}

async function transfer(item, barrierEpochMs) {
  const progress = [];
  let firstByteEpochMs = null;
  let sent = 0;
  async function* pacedBody() {
    const wait = barrierEpochMs - Date.now();
    if (wait > 0) await sleep(wait);
    const scheduleStart = performance.now();
    while (sent < payload.length) {
      const due = scheduleStart + (sent / bytesPerSecond) * 1000;
      const remaining = due - performance.now();
      if (remaining > 0) await sleep(remaining);
      const end = Math.min(sent + chunkBytes, payload.length);
      if (firstByteEpochMs === null) firstByteEpochMs = Date.now();
      progress.push({ epoch_ms: Date.now(), bytes: end });
      yield payload.subarray(sent, end);
      sent = end;
    }
  }
  const response = await fetch(item.signedUrl, {
    method: 'PUT',
    headers: { 'content-length': String(payload.length) },
    body: Readable.from(pacedBody()),
    duplex: 'half',
  });
  const acknowledgedEpochMs = Date.now();
  const etag = response.headers.get('etag');
  const durationSeconds = (acknowledgedEpochMs - firstByteEpochMs) / 1000;
  const intervals = [];
  for (let index = 1; index < progress.length; index += 1)
    intervals.push(progress[index].epoch_ms - progress[index - 1].epoch_ms);
  intervals.push(acknowledgedEpochMs - progress.at(-1).epoch_ms);
  return {
    ...item,
    status: response.status,
    etag,
    first_byte_epoch_ms: firstByteEpochMs,
    acknowledged_epoch_ms: acknowledgedEpochMs,
    duration_seconds: durationSeconds,
    throughput_mbps: (payload.length * 8) / durationSeconds / 1_000_000,
    max_progress_stall_seconds: Math.max(...intervals) / 1000,
    transferred_bytes: sent,
  };
}

async function complete(token, transferResult) {
  const result = await request(`/upload-sessions/${transferResult.uploadSessionId}/complete`, {
    method: 'POST',
    headers: headers(token, true),
    body: JSON.stringify({
      completed_parts: [{ part_number: 1, etag: transferResult.etag }],
      size_bytes: payloadBytes,
      sha256: payloadSha256,
    }),
  });
  return {
    status: result.response.status,
    response_status: result.body?.status ?? null,
    body_sha256: result.bodySha256,
    completed_epoch_ms: Date.now(),
  };
}

function dockerStats() {
  const result = spawnSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{json .}}', 'vinops-mega002-i6-postgres', 'vinops-mega002-i6-minio', 'vinops-mega002-i6-clamav'],
    { encoding: 'utf8' },
  );
  return { exit_code: result.status, rows: result.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

const ownerToken = await login('owner@vinops.test');
const outsiderToken = await login('member@vinops.test');
const rounds = [];
const allItems = [];
let crossTenant = null;
for (let round = 0; round <= measuredRounds; round += 1) {
  const prepared = await Promise.all(
    Array.from({ length: clientsPerRound }, (_, index) => prepareUpload(ownerToken, round, index)),
  );
  if (round === 0) {
    const before = await state(prepared[0]);
    const denied = await request(`/upload-sessions/${prepared[0].uploadSessionId}/parts/1/authorization`, {
      method: 'POST',
      headers: headers(outsiderToken),
    });
    const after = await state(prepared[0]);
    crossTenant = {
      status: denied.response.status,
      body_keys: denied.body && typeof denied.body === 'object' ? Object.keys(denied.body) : [],
      state_unchanged: sha256(JSON.stringify(before)) === sha256(JSON.stringify(after)),
    };
  }
  const barrier = Date.now() + 1_500;
  const resourceBefore = dockerStats();
  const transfers = await Promise.all(prepared.map((item) => transfer(item, barrier)));
  const completions = await Promise.all(transfers.map((item) => complete(ownerToken, item)));
  const resourceAfter = dockerStats();
  const timeline = transfers
    .flatMap((item) => [
      { at: item.first_byte_epoch_ms, delta: 1 },
      { at: item.acknowledged_epoch_ms, delta: -1 },
    ])
    .sort((left, right) => left.at - right.at || right.delta - left.delta);
  let active = 0;
  let maximumConcurrency = 0;
  for (const point of timeline) {
    active += point.delta;
    maximumConcurrency = Math.max(maximumConcurrency, active);
  }
  const entries = transfers.map((item, index) => ({
    ...item,
    signedUrl: undefined,
    completion: completions[index],
    transfer_ok: item.status >= 200 && item.status < 300,
    within_8_seconds: item.duration_seconds <= 8,
    within_link_cap: item.throughput_mbps <= capMbps,
    progress_ok: item.max_progress_stall_seconds <= 5,
  }));
  rounds.push({
    round,
    measured: round > 0,
    barrier_epoch_ms: barrier,
    maximum_concurrency: maximumConcurrency,
    resource_before: resourceBefore,
    resource_after: resourceAfter,
    uploads: entries,
  });
  allItems.push(...entries);
}

const completionStarted = Date.now();
const finalStates = new Map();
for (let attempt = 0; attempt < 600; attempt += 1) {
  const ids = allItems.map((item) => item.fileId);
  const result = await pool.query(
    `SELECT file.id, file.status, file.actual_size_bytes::text, file.actual_sha256,
      job.status AS job_status,
      (SELECT count(*)::int FROM vinops.file_scan_results scan WHERE scan.file_id=file.id) AS scan_count
     FROM vinops.file_objects file
     LEFT JOIN vinops.file_processing_jobs job ON job.file_id=file.id
     WHERE file.id = ANY($1::uuid[])`,
    [ids],
  );
  for (const row of result.rows) finalStates.set(row.id, row);
  if (result.rows.length === allItems.length && result.rows.every((row) => row.status === 'Available')) break;
  await sleep(500);
}
const scanQueueSeconds = (Date.now() - completionStarted) / 1000;
await pool.end();

const measured = rounds.filter((round) => round.measured).flatMap((round) => round.uploads);
const durations = measured.map((item) => item.duration_seconds);
const successCount = measured.filter(
  (item) => item.transfer_ok && item.completion.status === 202 && item.completion.response_status === 'Validating',
).length;
const checksumCount = measured.filter((item) => {
  const final = finalStates.get(item.fileId);
  return final?.status === 'Available' && final.actual_size_bytes === String(payloadBytes) && final.actual_sha256 === payloadSha256;
}).length;
const withinTarget = measured.filter((item) => item.within_8_seconds).length;
const progressPass = measured.filter((item) => item.progress_ok).length;
const result = {
  status:
    successCount === measured.length &&
    checksumCount === measured.length &&
    progressPass === measured.length &&
    (withinTarget / measured.length) * 100 >= 95 &&
    rounds.every((round) => round.maximum_concurrency === clientsPerRound) &&
    crossTenant.status === 404 &&
    crossTenant.state_unchanged
      ? 'PASS'
      : 'FAIL',
  environment: {
    api,
    database,
    storage_backend: 'MinIO S3-compatible HTTP on task-owned Docker container',
    payload_bytes: payloadBytes,
    payload_sha256: payloadSha256,
    network_model: 'deterministic per-client token-bucket pacing',
    client_cap_mbps: capMbps,
    pacing_mbps: pacingMbps,
    chunk_bytes: chunkBytes,
    warmup_rounds: 1,
    measured_rounds: measuredRounds,
    clients_per_round: clientsPerRound,
  },
  summary: {
    measured_uploads: measured.length,
    success_count: successCount,
    checksum_pass_count: checksumCount,
    progress_pass_count: progressPass,
    within_8_seconds_count: withinTarget,
    within_8_seconds_percent: (withinTarget / measured.length) * 100,
    p50_seconds: percentile(durations, 0.5),
    p95_seconds: percentile(durations, 0.95),
    p99_seconds: percentile(durations, 0.99),
    max_progress_stall_seconds: Math.max(...measured.map((item) => item.max_progress_stall_seconds)),
    max_concurrency: Math.max(...rounds.map((round) => round.maximum_concurrency)),
    transfer_errors: measured.filter((item) => !item.transfer_ok).length,
    completion_errors: measured.filter((item) => item.completion.status !== 202).length,
    scan_queue_seconds_separate: scanQueueSeconds,
    scan_queue_included_in_transfer_timing: false,
  },
  cross_tenant_canary: crossTenant,
  rounds,
  final_states: Object.fromEntries(finalStates),
};
await writeFile(
  'evidence/VIN-MEGA-002/i11/AC06_UPLOAD_PERFORMANCE_RAW.json',
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ status: result.status, summary: result.summary }, null, 2));
if (result.status !== 'PASS') process.exitCode = 1;
