import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

const api = 'http://127.0.0.1:4620/api/v1';
const projectId = '00000000-0000-4000-8000-000000009301';
const organizationId = '00000000-0000-4000-8000-000000009201';
const ownerId = '00000000-0000-4000-8000-000000009101';
const pool = new Pool({
  connectionString:
    'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_i2_test9',
  max: 2,
  application_name: 'vinops-mega002-i9-http-regressions',
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const payload = Buffer.from(
  '%PDF-1.4\n%VinOps i9\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n',
  'utf8',
);
const payloadSha256 = sha256(payload);

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep non-JSON response evidence hashed only.
  }
  return {
    status: response.status,
    body,
    evidence: {
      status: response.status,
      body_sha256: sha256(text),
      body_length: text.length,
      body_keys: body && typeof body === 'object' ? Object.keys(body) : [],
      correlation_id:
        response.headers.get('x-vinops-correlation-id') ??
        response.headers.get('x-correlation-id'),
    },
  };
}

async function login(email) {
  const response = await request('/auth/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'VinOps-Mega002!', device_name: 'i9-regression' }),
  });
  if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status}`);
  return { token: response.body.access_token, evidence: response.evidence };
}

function authHeaders(token, idempotency = false) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...(idempotency ? { 'idempotency-key': randomUUID() } : {}),
  };
}

async function createDocument(token, code) {
  const response = await request(`/projects/${projectId}/documents`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ code, title: `I9 ${code}`, document_type: 'drawing' }),
  });
  if (response.status !== 201) throw new Error(`createDocument failed: ${JSON.stringify(response)}`);
  return response;
}

async function createRevision(token, documentId, revisionCode) {
  const response = await request(`/documents/${documentId}/revisions`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      revision_code: revisionCode,
      purpose: 'i9 complete-upload regression',
      file: {
        filename: `${revisionCode}.pdf`,
        size_bytes: payload.length,
        media_type: 'application/pdf',
        sha256: payloadSha256,
      },
    }),
  });
  if (response.status !== 201) throw new Error(`createRevision failed: ${JSON.stringify(response)}`);
  return response;
}

async function uploadPart(token, uploadSessionId) {
  const authorization = await request(
    `/upload-sessions/${uploadSessionId}/parts/1/authorization`,
    { method: 'POST', headers: authHeaders(token) },
  );
  if (authorization.status !== 200)
    throw new Error(`authorizeUploadPart failed: ${JSON.stringify(authorization)}`);
  const signedUrl = authorization.body.url;
  const upload = await fetch(signedUrl, { method: 'PUT', body: payload });
  const etag = upload.headers.get('etag');
  if (!upload.ok || etag === null) throw new Error(`S3 upload part failed: ${upload.status}`);
  return {
    etag,
    evidence: {
      authorization: {
        ...authorization.evidence,
        signed_url_sha256: sha256(signedUrl),
      },
      upload_status: upload.status,
      etag_sha256: sha256(etag),
    },
  };
}

async function snapshot(fileId, uploadSessionId) {
  const result = await pool.query(
    `SELECT
      (SELECT jsonb_build_object('status',status,'failure_code',failure_code,'actual_size_bytes',actual_size_bytes,'actual_sha256',actual_sha256) FROM vinops.file_objects WHERE id=$1::uuid) AS file,
      (SELECT jsonb_build_object('status',status,'received_bytes',received_bytes,'completed_at',completed_at) FROM vinops.upload_sessions WHERE id=$2::uuid) AS upload_session,
      (SELECT count(*)::int FROM vinops.file_processing_jobs WHERE file_id=$1::uuid) AS job_count,
      (SELECT count(*)::int FROM vinops.file_scan_results WHERE file_id=$1::uuid) AS scan_count,
      (SELECT count(*)::int FROM vinops.file_derivatives WHERE file_id=$1::uuid) AS derivative_count,
      (SELECT count(*)::int FROM vinops.audit_events WHERE entity_id=$1::uuid AND action='upload.complete') AS audit_count,
      (SELECT count(*)::int FROM vinops.outbox_events WHERE aggregate_id=$1::uuid) AS outbox_count`,
    [fileId, uploadSessionId],
  );
  const value = result.rows[0];
  return { ...value, sha256: sha256(JSON.stringify(value)) };
}

const owner = await login('i9-owner@vinops.test');
const outsider = await login('i9-outsider@vinops.test');
const malformedSession = randomUUID();
const unauthMalformed = await request(`/upload-sessions/${malformedSession}/complete`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
  body: JSON.stringify({ malformed: true }),
});
const authMalformed = await request(`/upload-sessions/${malformedSession}/complete`, {
  method: 'POST',
  headers: authHeaders(owner.token, true),
  body: JSON.stringify({ malformed: true }),
});

const document = await createDocument(owner.token, `I9-${randomUUID().slice(0, 8)}`);
const validRevision = await createRevision(owner.token, document.body.id, 'P01');
const validUploadId = validRevision.body.upload_session.id;
const validFileId = validRevision.body.revision.file.id;
const validPart = await uploadPart(owner.token, validUploadId);
const validBefore = await snapshot(validFileId, validUploadId);
const validComplete = await request(`/upload-sessions/${validUploadId}/complete`, {
  method: 'POST',
  headers: authHeaders(owner.token, true),
  body: JSON.stringify({
    completed_parts: [{ part_number: 1, etag: validPart.etag }],
    size_bytes: payload.length,
    sha256: payloadSha256,
  }),
});
const validAfter = await snapshot(validFileId, validUploadId);

const deniedRevision = await createRevision(owner.token, document.body.id, 'P02');
const deniedUploadId = deniedRevision.body.upload_session.id;
const deniedFileId = deniedRevision.body.revision.file.id;
const deniedPart = await uploadPart(owner.token, deniedUploadId);
const deniedBefore = await snapshot(deniedFileId, deniedUploadId);
const deniedAuthorization = await request(
  `/upload-sessions/${deniedUploadId}/parts/1/authorization`,
  { method: 'POST', headers: authHeaders(outsider.token) },
);
const deniedComplete = await request(`/upload-sessions/${deniedUploadId}/complete`, {
  method: 'POST',
  headers: authHeaders(outsider.token, true),
  body: JSON.stringify({
    completed_parts: [{ part_number: 1, etag: deniedPart.etag }],
    size_bytes: payload.length,
    sha256: payloadSha256,
  }),
});
const deniedAfter = await snapshot(deniedFileId, deniedUploadId);

const transmittalId = randomUUID();
await pool.query(
  `INSERT INTO vinops.transmittals (
    id,organization_id,project_id,code,purpose,status,created_by,issued_at,snapshot_sha256
  ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'i9 RLS regression','Issued',$5::uuid,now(),$6)`,
  [transmittalId, organizationId, projectId, `I9-TR-${transmittalId.slice(0, 8)}`, ownerId, 'c'.repeat(64)],
);
await pool.query(
  `INSERT INTO vinops.transmittal_items (
    id,organization_id,project_id,transmittal_id,document_id,revision_id,context_key,
    document_code_snapshot,document_title_snapshot,revision_code_snapshot,file_sha256_snapshot
  ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'default',$7,$8,'P01',$9)`,
  [randomUUID(), organizationId, projectId, transmittalId, document.body.id, validRevision.body.revision.id, document.body.code, document.body.title, payloadSha256],
);
await pool.query(
  `INSERT INTO vinops.transmittal_recipients (
    id,organization_id,project_id,transmittal_id,recipient_type,recipient_reference,
    recipient_name_snapshot,recipient_address_snapshot,sent_at
  ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'external','i9-recipient','I9 Recipient',NULL,now())`,
  [randomUUID(), organizationId, projectId, transmittalId],
);
const transmittalExisting = await request(`/transmittals/${transmittalId}`, {
  headers: authHeaders(owner.token),
});
const transmittalMissing = await request(`/transmittals/${randomUUID()}`, {
  headers: authHeaders(owner.token),
});
const transmittalForbidden = await request(`/transmittals/${transmittalId}`, {
  headers: authHeaders(outsider.token),
});

const leakagePattern = /title|filename|tenant|project|signed|size|owner|revision|url/iu;
const result = {
  status:
    unauthMalformed.status === 401 &&
    authMalformed.status === 422 &&
    validComplete.status === 202 &&
    validComplete.body?.status === 'Validating' &&
    validAfter.job_count === 1 &&
    validAfter.audit_count === 1 &&
    validAfter.outbox_count >= 1 &&
    [403, 404].includes(deniedAuthorization.status) &&
    [403, 404].includes(deniedComplete.status) &&
    deniedBefore.sha256 === deniedAfter.sha256 &&
    transmittalExisting.status === 200 &&
    transmittalMissing.status === 404 &&
    [403, 404].includes(transmittalForbidden.status)
      ? 'PASS'
      : 'FAIL',
  runtime: { api, database: 'vinops_mega002_i2_test9' },
  logins: { owner: owner.evidence, outsider: outsider.evidence },
  complete_upload: {
    unauthenticated_malformed: { expected: 401, result: unauthMalformed.evidence },
    authenticated_malformed: { expected: 422, result: authMalformed.evidence },
    authorized_valid: {
      expected: 202,
      result: validComplete.evidence,
      response_status: validComplete.body?.status ?? null,
      upload_part: validPart.evidence,
      before: validBefore,
      after: validAfter,
      side_effects_changed: validBefore.sha256 !== validAfter.sha256,
    },
    forbidden: {
      authorization_expected: '403_or_404',
      authorization: deniedAuthorization.evidence,
      complete_expected: '403_or_404',
      complete: deniedComplete.evidence,
      before: deniedBefore,
      after: deniedAfter,
      side_effects_unchanged: deniedBefore.sha256 === deniedAfter.sha256,
      signed_url_leaked: deniedAuthorization.evidence.body_keys.includes('url'),
      metadata_leakage:
        deniedComplete.evidence.body_keys.some((key) => leakagePattern.test(key)) ||
        deniedAuthorization.evidence.body_keys.some((key) => leakagePattern.test(key)),
    },
  },
  transmittal_detail: {
    authorized_existing: { expected: 200, result: transmittalExisting.evidence },
    authorized_nonexistent: { expected: 404, result: transmittalMissing.evidence },
    forbidden_cross_tenant: {
      expected: '403_or_404',
      result: transmittalForbidden.evidence,
      metadata_leakage: transmittalForbidden.evidence.body_keys.some((key) =>
        leakagePattern.test(key),
      ),
    },
  },
  fixture_ids: {
    document_id: document.body.id,
    valid_revision_id: validRevision.body.revision.id,
    valid_file_id: validFileId,
    valid_upload_session_id: validUploadId,
    denied_revision_id: deniedRevision.body.revision.id,
    denied_file_id: deniedFileId,
    denied_upload_session_id: deniedUploadId,
    transmittal_id: transmittalId,
  },
};
await writeFile(
  'evidence/VIN-MEGA-002/i9/HTTP_REGRESSION_RESULTS.json',
  JSON.stringify(result, null, 2),
);
await writeFile(
  'evidence/VIN-MEGA-002/i9/I9_FIXTURE_IDS.json',
  JSON.stringify(result.fixture_ids, null, 2),
);
await pool.end();
console.log(JSON.stringify({ status: result.status, fixture_ids: result.fixture_ids }, null, 2));
if (result.status !== 'PASS') process.exitCode = 1;
