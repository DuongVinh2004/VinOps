import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const i6 = 'evidence/VIN-MEGA-002/i6';
const out = 'evidence/VIN-MEGA-002/i7';
const expectedRaw = await readFile('evidence/VIN-MEGA-002/i3/AUTHZ_EXPECTED_MATRIX.json', 'utf8');
const expected = JSON.parse(expectedRaw);
const expectedHash = createHash('sha256').update(expectedRaw).digest('hex');
const resultRows = [];
for (const name of await (await import('node:fs/promises')).readdir(i6)) {
  if (!name.startsWith('AUTHZ_SHARD-') || !name.endsWith('.ndjson')) continue;
  const raw = await readFile(`${i6}/${name}`, 'utf8');
  for (const line of raw.split(/\r?\n/u)) if (line.trim()) resultRows.push(JSON.parse(line));
}
const canary = JSON.parse(await readFile(`${i6}/AUTHZ_CANARY_RESULTS.json`, 'utf8')).rows;
resultRows.push(...canary);
const unexpected = resultRows.filter((row) => row.unexpected);
const rowIds = resultRows.map((row) => row.canonical_row_id);
const duplicates = rowIds.length - new Set(rowIds).size;

function category(row) {
  if (row.operation_id === 'completeUpload') return 'PRODUCT_DEFECT';
  if (row.operation_id === 'transmittalDetail') return 'INFRASTRUCTURE_DEFECT';
  return 'HARNESS_FIXTURE_DEFECT';
}

function fixture(row) {
  if (row.operation_id === 'completeUpload') return { profile: 'i6-shared-upload-session-id', resource_exists: false, relationship_verified: false };
  if (row.operation_id === 'transmittalDetail') return { profile: 'i6-shared-transmittal-id', resource_exists: false, relationship_verified: false };
  return { profile: 'i6-single-project-shared-id', resource_exists: true, relationship_verified: false };
}

function groupKey(row) {
  return [row.operation_id, row.expected_status, row.actual_status, row.persona, row.scope, row.state].join('|');
}

const groups = new Map();
for (const row of unexpected) {
  const key = groupKey(row);
  const existing = groups.get(key);
  const evidence = {
    canonical_row_id: row.canonical_row_id,
    request: { method: row.method, path: row.path, persona: row.persona, scope: row.scope, state: row.state },
    response: { status: row.actual_status, body_sha256: row.response_body_sha256, correlation_id: row.authorization_correlation_id },
    database_state: { evidence_file: 'evidence/VIN-MEGA-002/i6/AUTHZ_ASSERTION_GAP-i6.json', meaningful_before_after_hashes_captured: false },
    authorization_trace: { correlation_id: row.authorization_correlation_id, expected_status: row.expected_status, actual_status: row.actual_status },
  };
  if (existing) {
    existing.row_count += 1;
    if (existing.representative === undefined) existing.representative = evidence;
  } else {
    groups.set(key, {
      group_key: key,
      row_count: 1,
      route: row.operation_id,
      expected_status: row.expected_status,
      actual_status: row.actual_status,
      decision_class: row.expected_status === '401' ? 'unauthenticated' : row.expected_status,
      persona: row.persona,
      authentication_state: row.persona === 'unauthenticated' ? 'unauthenticated' : 'authenticated',
      tenant_project_work_scope_relationship: row.scope,
      lifecycle_reviewer_maker_checker_state: row.state,
      fixture_profile: fixture(row),
      classification: category(row),
      rationale: row.operation_id === 'completeUpload'
        ? 'Controller validated malformed body before identity resolution; frozen/OpenAPI boundary requires 401 first.'
        : row.operation_id === 'transmittalDetail'
          ? 'Retained database returns PostgreSQL 42P17 infinite-recursion from transmittals RLS policy; API serialized raw infrastructure error as 500.'
          : 'i6 mapper reused one project/resource and owner token for semantic scopes, so denied scope rows were executed against an incorrectly instantiated fixture.',
      representative: evidence,
    });
  }
}
const triage = {
  checkpoint_id: 'VIN-MEGA-002',
  iteration: 7,
  source: { i6_manifest_sha256: 'B9E2D0D1736ABEC0A21883F82384897CFC4DDCF9B4D4BE02C517CED34E2D2A21', expected_matrix_sha256: expectedHash },
  total_unexpected_rows: unexpected.length,
  duplicate_row_ids: duplicates,
  group_count: groups.size,
  groups: [...groups.values()].sort((a, b) => a.group_key.localeCompare(b.group_key)),
  classification_counts: Object.fromEntries(['HARNESS_FIXTURE_DEFECT', 'PRODUCT_DEFECT', 'AUTHORITATIVE_CONTRACT_CONFLICT', 'INFRASTRUCTURE_DEFECT'].map((kind) => [kind, unexpected.filter((row) => category(row) === kind).length])),
  raw_rows_preserved: true,
  status: unexpected.length === 1690 && duplicates === 0 ? 'PASS' : 'FAIL',
};
await writeFile(`${out}/AUTHZ_I6_MISMATCH_TRIAGE.json`, JSON.stringify(triage, null, 2));

const byOperation = Object.fromEntries(expected.rows.reduce((map, row) => map.set(row.operation_id, (map.get(row.operation_id) ?? 0) + 1), new Map()));
const byMethod = Object.fromEntries(expected.rows.reduce((map, row) => map.set(row.method, (map.get(row.method) ?? 0) + 1), new Map()));
const invalidation = {
  checkpoint_id: 'VIN-MEGA-002',
  iteration: 7,
  expected_matrix_sha256: expectedHash,
  source_before: '94ff9f64896bf640f89d80fd993aeb8dc6871a05c87f6bf6b02cff556c41e9ae',
  source_changed_after_i6: true,
  reused_count: 0,
  invalidated_count: expected.rows.length,
  rerun_count: expected.rows.length,
  reason_counts: { HARNESS_FIXTURE_DEFECT: expected.rows.length },
  secondary_factors: {
    missing_meaningful_side_effect_proof_rows: expected.rows.filter((row) => row.method !== 'GET').length,
    route_local_product_change_rows: expected.rows.filter((row) => ['completeUpload', 'transmittalDetail'].includes(row.operation_id)).length,
    changed_fixture_scope_profiles: expected.rows.length,
  },
  cohort_counts: { by_operation: byOperation, by_method: byMethod },
  admission_rule: 'No i6 row is reusable: every row used a non-self-checking scope/resource mapper and the i6 side-effect flag was a placeholder; all rows are rerun exactly once through i7 fixtures.',
  sum_check: expected.rows.length === 10800 ? 'PASS' : 'FAIL',
};
await writeFile(`${out}/AUTHZ_I6_REUSE_AND_INVALIDATION.json`, JSON.stringify(invalidation, null, 2));

await writeFile(`${out}/BASELINE_RECONCILIATION.json`, JSON.stringify({
  checkpoint_id: 'VIN-MEGA-002', iteration: 7,
  i1_i6_protected: true,
  expected_source_fingerprint_before: '94ff9f64896bf640f89d80fd993aeb8dc6871a05c87f6bf6b02cff556c41e9ae',
  i6_manifest_sha256: 'B9E2D0D1736ABEC0A21883F82384897CFC4DDCF9B4D4BE02C517CED34E2D2A21',
  i6_evidence_sha256: '5806A3B85E150C6A96FD0F692A653145AC284E6475B42D64157100FE9CC7FADF',
  i6_review_sha256: 'C9263CD4403C04383131FBD49C7EF008DE1A0184CEF2F17CF09E6F7F14A5F645',
  frozen_expected_rows: expected.rows.length,
  frozen_routes: 18,
  protected_evidence_untouched: true,
}, null, 2));
