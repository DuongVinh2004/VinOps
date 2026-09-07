import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const repositoryRoot = process.cwd();
const out = 'evidence/VIN-MEGA-002/i7';
const excluded = new Set(['.git', 'node_modules', 'evidence', '.tmp', 'dist', 'coverage', '.turbo', '.vite']);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(repositoryRoot, path).split(sep);
    if (rel.some((part) => excluded.has(part)) || /\.(zip|tsbuildinfo|log)$/u.test(rel.join('/'))) continue;
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
const files = (await walk(repositoryRoot)).sort();
const inventory = [];
for (const file of files) {
  const bytes = await readFile(file);
  inventory.push({ path: relative(repositoryRoot, file).replaceAll(sep, '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
const sourceFingerprint = createHash('sha256').update(inventory.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join('')).digest('hex');
const sourceDeltaFiles = ['apps/api/src/platform.controller.ts', 'apps/api/src/document.service.ts', 'apps/api/test/document-boundary.integration.test.ts'];
let delta = '';
for (const file of sourceDeltaFiles) {
  const baseline = `evidence/VIN-MEGA-002/review-source/${file}`;
  let left = baseline;
  try { await stat(baseline); } catch { left = 'NUL'; }
  try { delta += execFileSync('git', ['diff', '--no-index', '--unified=3', '--', left, file], { encoding: 'utf8' }); }
  catch (error) { delta += typeof error.stdout === 'string' ? error.stdout : `diff unavailable for ${file}: ${String(error)}\n`; }
}
await writeFile(`${out}/VIN-MEGA-002-i7-source.delta.patch`, delta);
await writeFile(`${out}/I7_SOURCE_INVENTORY.json`, JSON.stringify({ source_fingerprint: sourceFingerprint, changed_product_files: sourceDeltaFiles, cumulative_product_files: 7, additional_product_files: 3, migrations: 0, dependencies: 0, inventory }, null, 2));
const sha = async (path) => createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
const evidenceFiles = [];
for (const name of await readdir(out)) {
  if (name.endsWith('.zip') || name === 'VIN-MEGA-002-i7-manifest.json') continue;
  if ((await stat(`${out}/${name}`)).isFile()) evidenceFiles.push(name);
}
evidenceFiles.sort();
const fileHashes = {};
for (const name of evidenceFiles) fileHashes[name] = { sha256: await sha(`${out}/${name}`), bytes: (await stat(`${out}/${name}`)).size };
await writeFile(`${out}/VIN-MEGA-002-i7-manifest.json`, JSON.stringify({ project: 'VinOps', checkpoint_id: 'VIN-MEGA-002', iteration: 7, status: 'BLOCKED', context_mode: 'STRICT', evidence_mode: 'PATCH_FILE', generated_at: new Date().toISOString(), source_fingerprint: sourceFingerprint, expected_matrix_sha256: '10da18fe95aaddd84998a674c9ca00f43da710590a781aeb57406a450294fe0a', source_changes: { files: sourceDeltaFiles, cumulative_product_files: 7, additional_product_files: 3, migrations: 0, dependencies: 0 }, protected_inputs: { i6_manifest_sha256: 'B9E2D0D1736ABEC0A21883F82384897CFC4DDCF9B4D4BE02C517CED34E2D2A21', i6_evidence_sha256: '5806A3B85E150C6A96FD0F692A653145AC284E6475B42D64157100FE9CC7FADF', i6_review_sha256: 'C9263CD4403C04383131FBD49C7EF008DE1A0184CEF2F17CF09E6F7F14A5F645', i6_delta_sha256: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855' }, evidence_files: evidenceFiles, evidence_file_hashes: fileHashes, archive_hashes: { evidence_zip_sha256: 'computed-after-packaging', review_zip_sha256: 'computed-after-packaging', duplicates: 0, nested_archives: 0 }, verification: { focused_http_regression_exit_code: 0, pnpm_verify_exit_code: 1, pnpm_verify_status: 'FAIL', pnpm_verify_failure: 'corepack unavailable in execution environment' }, acceptance: { AC05: 'PASS', AC06: 'UNVERIFIED', AC08: 'BLOCKED', CONTROL_STATE_DELTA: 'BLOCKED' } }, null, 2));
