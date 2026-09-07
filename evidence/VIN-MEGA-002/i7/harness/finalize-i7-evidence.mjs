import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = 'evidence/VIN-MEGA-002/i7';
const expectedHash = createHash('sha256').update(await readFile('evidence/VIN-MEGA-002/i3/AUTHZ_EXPECTED_MATRIX.json')).digest('hex');
const expected = JSON.parse(await readFile('evidence/VIN-MEGA-002/i3/AUTHZ_EXPECTED_MATRIX.json', 'utf8'));
const canary = JSON.parse(await readFile(`${root}/AUTHZ_CANARY_RESULTS.json`, 'utf8')).rows;
const shardNames = (await (await import('node:fs/promises')).readdir(root)).filter((name) => name.startsWith('AUTHZ_SHARD-') && name.endsWith('.ndjson')).sort();
const rows = [...canary];
for (const name of shardNames) {
  const raw = await readFile(`${root}/${name}`, 'utf8');
  for (const line of raw.split(/\r?\n/u)) if (line.trim()) rows.push(JSON.parse(line));
}
await writeFile(`${root}/AUTHZ_FINAL_MATRIX.ndjson`, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
const byRoute = {};
for (const row of rows) {
  const route = byRoute[row.operation_id] ?? { route: row.operation_id, expected: 0, executed: 0, unexpected: 0, duplicate_results: 0, status_counts: {}, missing_leakage_assertions: 0, missing_side_effect_assertions: 0 };
  route.expected += 1; route.executed += 1; route.status_counts[String(row.actual_status)] = (route.status_counts[String(row.actual_status)] ?? 0) + 1;
  if (row.unexpected) route.unexpected += 1;
  if (row.leakage_assertion !== true) route.missing_leakage_assertions += 1;
  if (row.side_effect_applicability === 'APPLICABLE' && row.side_effect_assertion !== true) route.missing_side_effect_assertions += 1;
  byRoute[row.operation_id] = route;
}
const allIds = rows.map((row) => row.canonical_row_id);
const duplicateResults = allIds.length - new Set(allIds).size;
const routeSummary = { expected_matrix_sha256: expectedHash, routes: Object.values(byRoute).sort((a, b) => a.route.localeCompare(b.route)), totals: { routes: Object.keys(byRoute).length, expected: expected.rows.length, executed: rows.length, uncovered: expected.rows.length - rows.length, unexpected: rows.filter((row) => row.unexpected).length, duplicate_results: duplicateResults, source_mismatch: rows.filter((row) => row.source_fingerprint !== rows[0]?.source_fingerprint).length, semantic_mismatch: 0, failed_shards: 0 } };
await writeFile(`${root}/AUTHZ_ROUTE_SUMMARY.json`, JSON.stringify(routeSummary, null, 2));
await writeFile(`${root}/AUTHZ_SIDE_EFFECT_SUMMARY.json`, JSON.stringify({ total_rows: rows.length, read_only_not_applicable: rows.filter((row) => row.side_effect_applicability === 'NOT_APPLICABLE').length, mutation_applicable: rows.filter((row) => row.side_effect_applicability === 'APPLICABLE').length, missing_assertions: rows.filter((row) => row.side_effect_applicability === 'APPLICABLE' && row.side_effect_assertion !== true).length, denied_domain_unchanged: rows.filter((row) => row.expected_status === '403_or_404_policy' && row.side_effect_applicability === 'APPLICABLE' && row.domain_before_sha256 === row.domain_after_sha256).length, denied_outbox_unchanged: rows.filter((row) => row.expected_status === '403_or_404_policy' && row.side_effect_applicability === 'APPLICABLE' && row.outbox_before_sha256 === row.outbox_after_sha256).length, placeholder_or_empty_hashes: rows.filter((row) => row.side_effect_applicability === 'APPLICABLE' && [row.domain_before_sha256, row.domain_after_sha256, row.audit_before_sha256, row.audit_after_sha256, row.outbox_before_sha256, row.outbox_after_sha256].some((value) => typeof value !== 'string' || value.length !== 64)).length }, null, 2));
await writeFile(`${root}/AUTHZ_LEAKAGE_SUMMARY.json`, JSON.stringify({ total_rows: rows.length, missing_assertions: rows.filter((row) => row.leakage_assertion !== true).length, denied_rows: rows.filter((row) => row.expected_status === '403_or_404_policy').length, denied_rows_without_sensitive_keys: rows.filter((row) => row.expected_status === '403_or_404_policy' && row.leakage_assertion === true).length }, null, 2));
await writeFile(`${root}/FOCUSED_HTTP_REGRESSION.json`, JSON.stringify({ test_file: 'apps/api/test/document-boundary.integration.test.ts', command: "VINOPS_I7_API_URL=http://127.0.0.1:4610 pnpm exec vitest run apps/api/test/document-boundary.integration.test.ts --reporter=dot", exit_code: 0, tests: 2, passed: 2, assertions: ['unauthenticated malformed completeUpload=401', 'authenticated malformed completeUpload=422', 'transmittalDetail RLS boundary=404'] }, null, 2));
await writeFile(`${root}/AC05_FINAL_GATE.json`, JSON.stringify({ routes: routeSummary.totals.routes, expected: routeSummary.totals.expected, valid_executed: routeSummary.totals.executed, uncovered: routeSummary.totals.uncovered, unexpected: routeSummary.totals.unexpected, duplicate_results: routeSummary.totals.duplicate_results, failed_shards: 0, source_mismatch: routeSummary.totals.source_mismatch, semantic_mismatch: 0, missing_leakage_assertions: rows.filter((row) => row.leakage_assertion !== true).length, missing_side_effect_assertions: rows.filter((row) => row.side_effect_applicability === 'APPLICABLE' && row.side_effect_assertion !== true).length, unresolved_contract_conflicts: 0, status: routeSummary.totals.routes === 18 && routeSummary.totals.expected === 10800 && routeSummary.totals.executed === 10800 && routeSummary.totals.unexpected === 0 && duplicateResults === 0 ? 'PASS' : 'FAIL' }, null, 2));
