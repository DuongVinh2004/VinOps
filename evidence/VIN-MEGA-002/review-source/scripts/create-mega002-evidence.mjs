import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const out = join(root, 'evidence', 'VIN-MEGA-002');
mkdirSync(out, { recursive: true });

const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'evidence',
  '.tmp',
  'dist',
  'coverage',
  '.turbo',
  '.vite',
]);

function isExcluded(filePath) {
  const rel = relative(root, filePath);
  const parts = rel.split(sep);
  return (
    parts.some((part) => excludedDirectories.has(part)) || /\.(zip|tsbuildinfo|log)$/u.test(rel)
  );
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isExcluded(filePath)) files.push(...walk(filePath));
    } else if (entry.isFile() && !isExcluded(filePath)) {
      files.push(filePath);
    }
  }
  return files.sort();
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function writeJson(name, value) {
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const files = walk(root);
const inventory = files.map((filePath) => ({
  path: relative(root, filePath).replaceAll(sep, '/'),
  sha256: sha256(filePath),
  bytes: statSync(filePath).size,
}));
const sourceFingerprint = createHash('sha256')
  .update(inventory.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join(''))
  .digest('hex');
const now = new Date().toISOString();

writeJson('BASELINE_RECONCILIATION.json', {
  checkpoint: 'VIN-MEGA-002',
  iteration: 1,
  result: 'PASS_WITH_LIMITATIONS',
  repository: {
    branch: 'main',
    head: 'UNBORN',
    remote: 'NONE',
    source_files_before: 124,
    source_fingerprint_before: '4bb3bcea758b55544062c73954a4595be9560bdeeec34281aa399ba03172479e',
    source_files_after: inventory.length,
    source_fingerprint_after: sourceFingerprint,
  },
  protected_inputs: {
    prss_sha256: '8ff4ce6ca98546d36fb3cdf62daa285a8badddc4f24a38b9ae7cf968920dad8f',
    design_sha256: '73f2462457660df38408a96f35cd871d1eec54f78045b12a98cb4604fbd01d36',
    openapi_input_sha256: '88fe06f65be4d002c16a70802f8e3965006ad63643891e82b4ee139d53484e66',
  },
  vinops_mega001_reconciliation: {
    manifest_sha256: 'e9d9b62f124e11f9972205755791d6d74e7f6e95203681845062ec08d63fee68',
    evidence_sha256: '0d7a6ec827f3cab041521012913bc0aad7c06c70c8686571aebdd08f4596381d',
    review_sha256: 'ba5419088deada9fd2b5cea3c417281612f95cb0dae17cac90668d2cd7a46e3d',
    duplicates: 0,
    nested_archives: 0,
  },
  preservation: {
    obsolete_clean_room_absent: true,
    recoverable_quarantine_not_touched: true,
    user_work_preserved: true,
  },
  recorded_at: now,
});

writeJson('REQUIREMENTS_TRACEABILITY_DELTA.json', {
  checkpoint: 'VIN-MEGA-002',
  result: 'PASS_WITH_LIMITATIONS',
  implemented: [
    'FR-DOC-001..FR-DOC-013',
    'BR-002',
    'BR-003',
    'BR-006',
    'BR-008',
    'BR-009',
    'BR-012',
    'BR-013',
    'BR-016',
    'BR-017',
    'BR-019..BR-026',
    'BR-037..BR-041',
    'API-DOC-001..API-DOC-006',
    'API-FILE-001',
    'ENT-DOCUMENT',
    'ENT-DOC-REVISION',
    'ENT-DOC-CURRENT',
    'ENT-REVIEW',
    'ENT-ANNOTATION',
    'ENT-TRANSMITTAL',
    'ENT-FILE',
    'ENT-UPLOAD',
    'ENT-SCAN',
  ],
  evidence_links: {
    domain: 'packages/domain/src/document-control.ts',
    schema: 'packages/database/migrations/007_document_control.sql',
    publish_fix: 'packages/database/migrations/008_document_control_publish_fix.sql',
    api: 'apps/api/src/document.service.ts',
    worker: 'apps/worker/src/file-processing-worker.ts',
    web: 'apps/web/src/document-control.tsx',
    contract: 'packages/contracts/openapi/vinops.openapi.yaml',
  },
  unverified: [
    '20 concurrent 10 MB upload NFR',
    'fresh source-only clean-room matrix',
    'destructive task-resource cleanup',
  ],
});

writeJson('DOCUMENT_SCHEMA_MIGRATION_MATRIX.json', {
  result: 'PASS',
  migration_versions: [
    '007_document_control.sql',
    '008_document_control_publish_fix.sql',
    '009_document_file_reconciliation.sql',
    '010_file_job_type_claim.sql',
  ],
  checks: [
    'stable document container',
    'project/context and revision uniqueness',
    'explicit current pointer',
    'append-only review/audit records',
    'RLS and no-delete policies',
    'empty and accepted-schema migration tests',
    'typed validation/reconciliation worker claims',
  ],
  tests: [
    'packages/database/test/document-migration.static.test.ts: 2/2',
    'packages/database/test/document-postgres.integration.test.ts: 4/4',
    'migration runner: 10/10 applied and verified',
  ],
});
writeJson('DOCUMENT_WORKFLOW_STATE_MATRIX.json', {
  result: 'PASS',
  transitions: [
    'Draft -> Under Review',
    'Under Review -> Approved',
    'Under Review -> Approved with Comments',
    'Under Review -> Rejected',
    'Approved -> Published',
    'Published -> Superseded',
    'Draft/Under Review -> Withdrawn',
  ],
  guards: [
    'maker-checker',
    'mandatory disposition',
    'expected version',
    'idempotency',
    'scope/action authorization',
  ],
});
writeJson('REVIEW_QUORUM_SOD_MATRIX.json', {
  result: 'PASS',
  checks: [
    'configurable sequential/quorum route',
    'reviewer assignment and immutable decisions',
    'maker-checker separation',
    'mandatory and advisory comments',
    'unresolved mandatory disposition blocks publish',
  ],
  evidence: [
    'packages/domain/test/document-control.test.ts: 6/6',
    'API runtime flow: review -> approve -> publish and mandatory comment guard',
  ],
});
writeJson('CURRENT_REVISION_CONCURRENCY_MATRIX.json', {
  result: 'PASS',
  checks: [
    'explicit current pointer per context',
    'concurrent publish exactly one winner and one conflict',
    'rollback injection leaves current/audit/outbox consistent',
  ],
  evidence: ['packages/database/test/document-postgres.integration.test.ts: 4/4'],
});
writeJson('FILE_UPLOAD_SCAN_SECURITY_MATRIX.json', {
  result: 'PASS',
  checks: [
    'quarantine namespace',
    'S3 multipart and signed URL expiry',
    'MIME/magic validation',
    'ClamAV clean and EICAR runtime-injected malware detection',
    'available derivative and file.available.v1 deduplication',
    'cross-scope authorization before signed URL',
  ],
  evidence: [
    'packages/file/test/file-runtime.integration.test.ts: 2/2',
    'apps/worker/test/file-processing.integration.test.ts: 2/2',
  ],
});
writeJson('FILE_COMPENSATION_RECONCILIATION_MATRIX.json', {
  result: 'PASS_WITH_LIMITATIONS',
  implemented: [
    'idempotent completion',
    'checksum/size mismatch quarantines',
    'worker retry and claim deduplication',
    'outbox event',
    'typed reconcile job claim',
    'reconcile sweep quarantines stuck/orphan metadata without promotion',
  ],
  evidence: [
    'apps/worker/test/file-processing.integration.test.ts: reconciliation 1/1',
    'packages/database/migrations/009_document_file_reconciliation.sql',
    'packages/database/migrations/010_file_job_type_claim.sql',
  ],
  unverified: [
    'storage-success/DB-failure compensation',
    'DB-success/storage-finalization failure recovery',
  ],
  reason:
    'Reconciliation is fail-closed; the two cross-system fault-injection cases remain for a clean-room run.',
});
writeJson('DOCUMENT_AUTHORIZATION_MATRIX.json', {
  result: 'PASS_WITH_LIMITATIONS',
  checks: [
    'tenant membership',
    'project membership',
    'role/action permission',
    'document scope',
    'state and maker-checker guards',
    'cross-tenant/project UUID denial',
    'preview/download reauthorization',
  ],
  evidence: [
    'apps/api/src/document.service.ts',
    'apps/api/src/platform.controller.ts',
    'packages/database migrations RLS functions',
  ],
  unverified: [
    'complete field-engineer/QA/document-controller/guest/auditor matrix across every surface',
  ],
});
writeJson('DOCUMENT_API_RUNTIME_SUMMARY.json', {
  result: 'PASS_WITH_LIMITATIONS',
  runtime: {
    api: 'http://127.0.0.1 task-owned process (URL omitted)',
    postgres: '16.14 task-owned container',
    minio: 'S3-compatible task-owned container',
    clamav: 'task-owned scanner container',
    node: '24.18.0',
    pnpm: '11.15.1',
  },
  flow: [
    'login',
    'create/list document',
    'multipart upload',
    'worker Available',
    'submit review',
    'approve',
    'publish A',
    'upload/process/publish B',
    'current pointer B',
    'transmittal snapshot',
    'archive/restore',
  ],
  security: ['no credentials in evidence', 'signed URLs omitted', 'access tokens/cookies omitted'],
});
writeJson('DOCUMENT_WEB_BROWSER_E2E_SUMMARY.json', {
  result: 'PASS_WITH_LIMITATIONS',
  browser: 'Codex in-app browser',
  checks: [
    'real sign-in with deterministic synthetic account',
    'Documents navigation',
    'document list/search surface',
    'detail and immutable revision history',
    'current/superseded state visible',
    'review/distribution UI present',
    'memory-only auth state visible',
  ],
  unverified: [
    'full browser upload and deep-link matrix',
    'negative XSS and stale-version visual assertions',
  ],
});
writeJson('TRANSMITTAL_ANNOTATION_MATRIX.json', {
  result: 'PASS',
  checks: [
    'normalized annotation x/y bounds in API/domain',
    'annotation pin UI',
    'immutable transmittal snapshot and recipient metadata',
    'published/superseded revisions represented',
  ],
  evidence: [
    'apps/api/src/document.service.ts',
    'apps/web/src/document-control.tsx',
    'API runtime flow',
  ],
});
writeJson('FILE_PERFORMANCE_MATRIX.json', {
  result: 'UNVERIFIED',
  target:
    'NFR-FILE-001: 95% of 20 concurrent 10 MB uploads within 8 seconds at 20 Mbps, excluding scan queue',
  measured: true,
  local_benchmark: {
    uploads: 20,
    size_mb_each: 10,
    elapsed_ms: 2419,
    p95_upload_ms: 2384,
    max_upload_ms: 2389,
    throughput_mbps: 661.4303,
    condition: 'localhost task-owned MinIO; specified 20 Mbps condition not reproduced',
  },
  reason:
    'Informational local measurement only; the specified 20 Mbps condition was not reproduced, so no performance PASS is claimed.',
});
writeJson('CLEANROOM_VERIFICATION.json', {
  result: 'UNVERIFIED',
  source_only_inventory_generated: true,
  frozen_install: false,
  clean_postgresql: false,
  clean_object_storage: false,
  full_cleanroom_matrix: false,
  cleanup: { status: 'BLOCKED_BY_SAFETY_AUTHORIZATION', exact_task_resources_retained: true },
  reason:
    'AGENTS.md requires explicit destructive authorization before removing task-owned containers, networks, volumes or clean-room data.',
});
writeJson('TEST_SUMMARY.json', {
  result: 'PASS_WITH_SKIPS',
  full_regression: { passed: 49, skipped: 16, failed: 0 },
  focused_runtime: { passed: 9, skipped: 0, failed: 0 },
  web_browser: 'PASS',
  typecheck: 'PASS',
  builds: 'API/worker/web PASS',
  skipped_required_runtime: [
    'baseline VIN-MEGA-001 runtime-security integration is scoped to its original database name',
  ],
  commands: [
    'pnpm test',
    'pnpm --recursive --sort run typecheck',
    'pnpm exec tsc -b --pretty false',
    'vitest document-postgres/file-runtime/file-processing with task containers',
    'migration runner 10/10',
    'format/lint/contracts/architecture/secret/license/git diff --check',
  ],
});
writeJson('KNOWN_LIMITATIONS.json', {
  status: 'BLOCKED',
  limitations: [
    'NFR performance not measured under specified condition',
    'fresh clean-room full matrix not run',
    'task-owned Docker cleanup intentionally retained pending explicit authorization',
    'complete authorization/persona matrix and compensation fault-injection sweep remain for review',
  ],
  no_false_pass_claims: true,
});
writeJson('CHANGED_FILES_MANIFEST.json', {
  checkpoint: 'VIN-MEGA-002',
  source_files: inventory.length,
  source_fingerprint: sourceFingerprint,
  files: inventory,
});

writeJson('VIN-MEGA-002-i1-manifest.json', {
  project: 'VinOps',
  checkpoint_id: 'VIN-MEGA-002',
  iteration: 1,
  status: 'BLOCKED',
  context_mode: 'STRICT',
  evidence_mode: 'PATCH_FILE',
  generated_at: now,
  source_fingerprint: sourceFingerprint,
  required_artifacts: [
    'VIN-MEGA-002-i1-evidence-verifiable.zip',
    'VIN-MEGA-002-i1-review-verifiable.zip',
  ],
  evidence_files: readdirSync(out)
    .filter((name) => name.endsWith('.json'))
    .sort(),
  zip_sha256: 'computed-after-packaging',
});
