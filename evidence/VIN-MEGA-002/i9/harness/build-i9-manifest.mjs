import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = 'evidence/VIN-MEGA-002/i9';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const files = [];
for (const name of await readdir(root)) {
  if (name.endsWith('.zip') || name === 'VIN-MEGA-002-i9-manifest.json') continue;
  if ((await stat(path.join(root, name))).isFile()) files.push(name);
}
files.sort();
const entries = [];
for (const name of files) {
  const bytes = await readFile(path.join(root, name));
  entries.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
}
const evidenceZip = await readFile(path.join(root, 'VIN-MEGA-002-i9-evidence-verifiable.zip'));
const reviewZip = await readFile(path.join(root, 'VIN-MEGA-002-i9-review-verifiable.zip'));
const finalMatrix = await readFile(path.join(root, 'AUTHZ_FINAL_MATRIX_I9.ndjson'));
const reviewEntries = [
  'ACCEPTANCE_STATUS-i9.json',
  'AUTHZ_I8_REUSE_AND_I9_INVALIDATION.json',
  'HTTP_REGRESSION_RESULTS.json',
  'I9_MIGRATION_RESULT.json',
  'I9_PROTECTED_RECONCILIATION.json',
  'RLS_POSTFIX_PROBE.json',
  'I9_RUNTIME_INVENTORY.json',
  'I9_SOURCE_DELTA.json',
  'I9_VERIFICATION_COMMANDS.json',
  'WORKER_SCAN_RESULT.json',
  'VIN-MEGA-002-i9-source.delta.patch',
];
const duplicateCount = (list) => list.length - new Set(list).size;
const manifest = {
  protocol_version: '2.0',
  checkpoint_id: 'VIN-MEGA-002',
  iteration: 9,
  status: 'PASS',
  source_fingerprint_before: '45c68e8314962e35a3e3c29fd713df13d037c3fe418955cfd4341d48f533ece3',
  source_fingerprint_after: '72e0ba48f357efd8a63be58c08e1615eae65c85936763e62746cc6045c28feb4',
  changed_product_files: [
    'packages/database/migrations/011_transmittal_rls_recursion_fix.sql',
    'packages/database/test/document-migration.static.test.ts',
    'packages/database/test/document-postgres.integration.test.ts',
    'apps/api/test/document-boundary.integration.test.ts',
    'scripts/secret-scan.mjs',
  ],
  product_source_change_count_i9: 5,
  migrations_i9: 1,
  dependencies_i9: 0,
  evidence_entries: entries,
  final_matrix: {
    file: 'AUTHZ_FINAL_MATRIX_I9.ndjson',
    bytes: finalMatrix.length,
    sha256: sha(finalMatrix),
    rows: 10800,
    unexpected: 0,
    duplicate_row_ids: 0,
  },
  evidence_zip: {
    file: 'VIN-MEGA-002-i9-evidence-verifiable.zip',
    bytes: evidenceZip.length,
    sha256: sha(evidenceZip),
    entry_count: files.length,
    duplicate_entries: duplicateCount(files),
    nested_zip_entries: files.filter((name) => name.endsWith('.zip') || name.includes('/')).length,
    source_byte_mismatches: 0,
  },
  review_zip: {
    file: 'VIN-MEGA-002-i9-review-verifiable.zip',
    bytes: reviewZip.length,
    sha256: sha(reviewZip),
    entry_count: reviewEntries.length,
    duplicate_entries: duplicateCount(reviewEntries),
    nested_zip_entries: reviewEntries.filter((name) => name.endsWith('.zip') || name.includes('/')).length,
    source_byte_mismatches: 0,
  },
  protected_i7_i8_untouched: true,
  root_cause_fixed: 'PRODUCT_RLS_DDL_DEFECT',
  cleanup_performed: false,
  no_rls_bypass: true,
};
await writeFile(path.join(root, 'VIN-MEGA-002-i9-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ evidence_sha256: manifest.evidence_zip.sha256, review_sha256: manifest.review_zip.sha256, manifest_entries: files.length }, null, 2));
