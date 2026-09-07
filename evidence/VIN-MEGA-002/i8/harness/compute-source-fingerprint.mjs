import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'evidence', '.tmp', 'dist', 'coverage', '.turbo', '.vite']);
const paths = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const rel = path.relative(root, full).split(path.sep);
    if (rel.some((part) => ignored.has(part)) || /\.(zip|tsbuildinfo|log)$/u.test(rel.join('/'))) continue;
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) paths.push(full);
  }
}
await walk(root);
paths.sort();
const lines = [];
for (const file of paths) {
  const bytes = await readFile(file);
  lines.push(`${path.relative(root, file).replaceAll(path.sep, '/')}\0${createHash('sha256').update(bytes).digest('hex')}\0${bytes.length}\n`);
}
const fingerprint = createHash('sha256').update(lines.join('')).digest('hex');
await writeFile('evidence/VIN-MEGA-002/i8/I8_SOURCE_FINGERPRINT.json', JSON.stringify({ fingerprint, expected_i7_after: '45c68e8314962e35a3e3c29fd713df13d037c3fe418955cfd4341d48f533ece3', matches_i7: fingerprint === '45c68e8314962e35a3e3c29fd713df13d037c3fe418955cfd4341d48f533ece3', file_count: paths.length }, null, 2));
console.log(JSON.stringify({ fingerprint, file_count: paths.length }, null, 2));
