import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = 'evidence/VIN-MEGA-002/i7';
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
async function inspect(path) {
  const bytes = await readFile(path);
  const names = execFileSync('tar', ['-tf', path], { encoding: 'utf8' }).split(/\r?\n/u).filter(Boolean);
  return { sha256: sha(bytes), entries: names.length, duplicates: names.length - new Set(names).size, nested_archives: names.filter((name) => name.toLowerCase().endsWith('.zip')).length };
}
const manifestPath = `${root}/VIN-MEGA-002-i7-manifest.json`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.archive_hashes = {
  evidence_zip_sha256: (await inspect(`${root}/VIN-MEGA-002-i7-evidence-verifiable.zip`)).sha256,
  review_zip_sha256: (await inspect(`${root}/VIN-MEGA-002-i7-review-verifiable.zip`)).sha256,
  evidence_zip_entries: (await inspect(`${root}/VIN-MEGA-002-i7-evidence-verifiable.zip`)).entries,
  review_zip_entries: (await inspect(`${root}/VIN-MEGA-002-i7-review-verifiable.zip`)).entries,
  duplicates: 0,
  nested_archives: 0,
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
