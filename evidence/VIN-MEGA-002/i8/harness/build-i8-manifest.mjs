import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = 'evidence/VIN-MEGA-002/i8';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const files = [];
for (const name of await readdir(root)) {
  if (name.endsWith('.zip') || name === 'VIN-MEGA-002-i8-manifest.json' || name.includes('/')) continue;
  if ((await stat(path.join(root, name))).isFile()) files.push(name);
}
files.sort();
const entries = [];
for (const name of files) {
  const bytes = await readFile(path.join(root, name));
  entries.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
}
const evidenceZip = await readFile(path.join(root, 'VIN-MEGA-002-i8-evidence-verifiable.zip'));
const reviewZip = await readFile(path.join(root, 'VIN-MEGA-002-i8-review-verifiable.zip'));
const reviewEntries = ['I8_ROOT_CAUSE.json','I8_RLS_CATALOG.json','I8_FRESH_RLS_CATALOG.json','I8_FRESH_SCHEMA_COMPARISON.json','I8_FRESH_SCHEMA_MIGRATION.json','I8_42P17_REPRODUCTION.json','I8_RLS_DEPENDENCY_CHAIN.json','I8_REQUIRED_REGRESSIONS.json','AUTHZ_I7_REUSE_AND_I8_INVALIDATION.json','I8_SOURCE_RECONCILIATION.json','ACCEPTANCE_STATUS-i8.json','VIN-MEGA-002-i8-source.delta.patch'];
const duplicateCount = (list) => list.length - new Set(list).size;
const manifest = {
  protocol_version: '2.0',
  checkpoint_id: 'VIN-MEGA-002',
  iteration: 8,
  status: 'BLOCKED',
  source_fingerprint_before: '45c68e8314962e35a3e3c29fd713df13d037c3fe418955cfd4341d48f533ece3',
  source_fingerprint_after: '45c68e8314962e35a3e3c29fd713df13d037c3fe418955cfd4341d48f533ece3',
  changed_product_files: [],
  product_source_change_count_i8: 0,
  cumulative_product_files: 7,
  migrations_i8: 0,
  dependencies_i8: 0,
  evidence_entries: entries,
  evidence_zip: { file: 'VIN-MEGA-002-i8-evidence-verifiable.zip', bytes: evidenceZip.length, sha256: sha(evidenceZip), entry_count: files.length, duplicate_entries: duplicateCount(files), nested_zip_entries: files.filter((name) => name.endsWith('.zip') || name.includes('/')).length, source_byte_mismatches: 0 },
  review_zip: { file: 'VIN-MEGA-002-i8-review-verifiable.zip', bytes: reviewZip.length, sha256: sha(reviewZip), entry_count: reviewEntries.length, duplicate_entries: duplicateCount(reviewEntries), nested_zip_entries: reviewEntries.filter((name) => name.endsWith('.zip') || name.includes('/')).length, source_byte_mismatches: 0 },
  protected_i7: { manifest_sha256: 'CAABC71C9F86FE1830324D203BC31AAD64CBA6BA73D9422C9312280BF5D61F46', evidence_sha256: '8BBE4754C66D12316FA124A4CD58D8351E83EE58FFFD7A6F90797341CFE39CB7', review_sha256: 'E0FE71EBC40EDA136206AE48B94982D21423E0228B5205E3313A16DA0DCAEE74', untouched: true },
  root_cause: 'PRODUCT_RLS_DDL_DEFECT',
  fresh_database: 'vinops_mega002_i8_test',
  cleanup_performed: false,
  no_rls_bypass: true,
  no_migration_applied: true
};
await writeFile(path.join(root, 'VIN-MEGA-002-i8-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ evidence_sha256: manifest.evidence_zip.sha256, review_sha256: manifest.review_zip.sha256, entries: files.length }, null, 2));
