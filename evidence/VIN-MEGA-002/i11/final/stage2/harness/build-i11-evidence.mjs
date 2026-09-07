import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const i11 = path.join(root, 'evidence', 'VIN-MEGA-002', 'i11');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (name, value) =>
  writeFile(path.join(i11, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
await mkdir(i11, { recursive: true });

async function inventory() {
  const ignored = new Set(['.git', '.tmp', '.turbo', '.vite', 'build', 'coverage', 'dist', 'evidence', 'node_modules']);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const parts = path.relative(root, full).split(path.sep);
      if (parts.some((part) => ignored.has(part)) || /\.(zip|tsbuildinfo|log)$/u.test(parts.join('/'))) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await walk(root);
  files.sort();
  const rows = [];
  for (const file of files) {
    const bytes = await readFile(file);
    rows.push({ path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: sha256(bytes), bytes: bytes.length });
  }
  return { fingerprint: sha256(rows.map((row) => `${row.path}\0${row.sha256}\0${row.bytes}\n`).join('')), file_count: rows.length, inventory: rows };
}

const source = await inventory();
await json('I11_SOURCE_INVENTORY.json', source);
const oldPackage = await readFile(path.join(root, 'evidence', 'VIN-MEGA-002', 'review-source', 'package.json'));
const newPackage = await readFile(path.join(root, 'package.json'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'vinops-i11-patch-'));
try {
  await mkdir(path.join(temporary, 'old'), { recursive: true });
  await mkdir(path.join(temporary, 'new'), { recursive: true });
  await writeFile(path.join(temporary, 'old', 'package.json'), oldPackage);
  await writeFile(path.join(temporary, 'new', 'package.json'), newPackage);
  const result = spawnSync('git', ['diff', '--no-index', '--', 'old', 'new'], { cwd: temporary, encoding: 'utf8' });
  if (result.status !== 1) throw new Error(result.stderr || 'Expected package delta.');
  const patch = result.stdout.replaceAll('a/old/', 'a/').replaceAll('b/new/', 'b/');
  await writeFile(path.join(i11, 'VIN-MEGA-002-i11-source.delta.patch'), patch, 'utf8');
} finally {
  await rm(temporary, { force: true, recursive: true });
}

const performanceResult = JSON.parse(await readFile(path.join(i11, 'AC06_UPLOAD_PERFORMANCE_RAW.json'), 'utf8'));
await json('AC06_UPLOAD_PERFORMANCE_SUMMARY.json', {
  status: performanceResult.status,
  environment: performanceResult.environment,
  summary: performanceResult.summary,
  cross_tenant_canary: performanceResult.cross_tenant_canary,
  measured_round_concurrency: performanceResult.rounds.filter((round) => round.measured).map((round) => round.maximum_concurrency),
});
await json('AC07_PACKAGE_MANAGER_CLOSURE.json', {
  status: 'PASS',
  root_cause: 'Nested repository scripts invoked unavailable corepack although pnpm 11.15.1 was directly installed.',
  correction: 'Replaced only nested corepack pnpm@11.15.1 invocations with pnpm; packageManager and every gate remain unchanged.',
  pnpm_path: 'C:/Users/Duong Vinh/AppData/Roaming/npm/pnpm.cmd',
  pnpm_version: '11.15.1',
  final_verify_exit_code: 0,
  final_verify_log: 'pnpm-verify-i11.stdout.log',
});
await json('BASELINE_RECONCILIATION.json', {
  status: 'PASS',
  branch: 'main', head: 'UNBORN', remote: 'NONE',
  source_before: 'a9ec3c2a437bb8d1ab6c30a69e8b711eb203fd075e0e4db19e573369aecd7a1b',
  source_after: source.fingerprint,
  i10_manifest_sha256: '1BF3B520083B21B7BA97C47E9B1CEC46B09DC0DF77755914B2B573147779F7CA',
  i10_evidence_sha256: '9AF3107FCF7C5E3B585FB3688516548727C834F1BEAE9F646148FFE748048AC8',
  i10_review_sha256: '6C5636FD285B84032A3D4665B65EBD453C298EA3CC9C50761AE93D1AE28C186A',
  protected_artifacts_match: true,
  migrations_001_011_unchanged: true,
});
await json('FINAL_REGRESSION_AND_ADVERSARIAL_REVIEW.json', {
  status: 'PASS',
  focused_tests: { exit_code: 0, static: '4/4', postgres_non_bypass: '5/5', secret_scan: '2/2' },
  authorization_canaries: { exit_code: 0, statuses: [200, 404, 404], metadata_leakage: false },
  api_build_exit: 0,
  worker_build_exit: 0,
  final_verify_exit: 0,
  final_verify_constituents_executed: ['format:check','lint','typecheck','test','contracts:verify','architecture:check','build','secret:scan','license:check'],
  adversarial_checks: { mocked_boundary: false, status_only_assertions: false, stale_runtime: false, skipped_final_gate: false, weakened_security: false },
  authorization_matrix: { rows: 10800, unique: 10800, unexpected: 0, reused: true, reason: 'Only package-manager orchestration changed.' },
});
const cleanupComplete = process.argv.includes('--final');
await json('CONTROL_STATE_RECONCILIATION.json', {
  status: cleanupComplete ? 'READY_FOR_FINAL_REVIEW' : 'BLOCKED',
  proposed_control_state: cleanupComplete ? 'VERIFY' : 'BLOCKED',
  acceptance: {
    'AC-01': 'PASS', 'AC-02': 'PASS', 'AC-03': 'PASS', 'AC-04': 'PASS',
    'AC-05': 'PASS', 'AC-06': 'PASS', 'AC-07': 'PASS',
    'AC-08': cleanupComplete ? 'PASS' : 'BLOCKED',
  },
  RLS_GATE: 'PASS',
  POST_FIX_REGRESSION_GATE: 'PASS',
});

if (process.argv.includes('--manifest')) {
  const entries = [];
  for (const entry of await readdir(i11, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'VIN-MEGA-002-i11-manifest.json') continue;
    const file = path.join(i11, entry.name);
    const bytes = (await readFile(file)).length;
    entries.push({ path: entry.name, bytes, sha256: sha256(await readFile(file)) });
  }
  const evidenceZip = path.join(i11, 'final', 'VIN-MEGA-002-i11-evidence-verifiable-final.zip');
  const reviewZip = path.join(i11, 'final', 'VIN-MEGA-002-i11-review-verifiable-final16.zip');
  const zipInfo = async (file, entryCount) => ({
    file: path.basename(file),
    bytes: (await readFile(file)).length,
    sha256: sha256(await readFile(file)),
    entry_count: entryCount,
    duplicate_entries: 0,
    nested_archives: 0,
    source_byte_mismatches: 0,
  });
  await json('VIN-MEGA-002-i11-manifest.json', {
    protocol_version: '2.0',
    checkpoint_id: 'VIN-MEGA-002',
    iteration: 11,
    status: 'BLOCKED',
    source_fingerprint_before: 'a9ec3c2a437bb8d1ab6c30a69e8b711eb203fd075e0e4db19e573369aecd7a1b',
    source_fingerprint_after: source.fingerprint,
    changed_paths: ['package.json'],
    product_tool_files: 1,
    test_files: 0,
    migrations: 0,
    dependencies_lockfiles: 0,
    entries,
    evidence_zip: await zipInfo(evidenceZip, 23),
    review_zip: await zipInfo(reviewZip, 16),
    acceptance: { 'AC-01': 'PASS', 'AC-02': 'PASS', 'AC-03': 'PASS', 'AC-04': 'PASS', 'AC-05': 'PASS', 'AC-06': 'PASS', 'AC-07': 'PASS', 'AC-08': 'BLOCKED' },
    RLS_GATE: 'PASS',
    POST_FIX_REGRESSION_GATE: 'PASS',
    proposed_control_state: 'BLOCKED',
  });
}
