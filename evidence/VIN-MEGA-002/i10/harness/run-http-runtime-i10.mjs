import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const i9Harness = path.join(root, 'evidence', 'VIN-MEGA-002', 'i9', 'harness');
const i10 = path.join(root, 'evidence', 'VIN-MEGA-002', 'i10');
await mkdir(i10, { recursive: true });
const runtimeDirectory = await mkdtemp(path.join(path.dirname(import.meta.filename), '.runtime-'));

async function execute(name, transforms) {
  let source = await readFile(path.join(i9Harness, name), 'utf8');
  for (const [before, after] of transforms) source = source.replaceAll(before, after);
  const target = path.join(runtimeDirectory, name);
  await writeFile(target, source, 'utf8');
  await import(`${pathToFileURL(target).href}?i10=${Date.now()}`);
}

try {
  await execute('seed-i9-runtime.mjs', []);
  await execute('run-http-regressions-i9.mjs', [
    [
      'evidence/VIN-MEGA-002/i9/HTTP_REGRESSION_RESULTS.json',
      'evidence/VIN-MEGA-002/i10/HTTP_REGRESSION_RESULTS.json',
    ],
    [
      'evidence/VIN-MEGA-002/i9/I9_FIXTURE_IDS.json',
      'evidence/VIN-MEGA-002/i10/I10_FIXTURE_IDS.json',
    ],
  ]);
} finally {
  await rm(runtimeDirectory, { force: true, recursive: true });
}
