import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set([
  '.git',
  'node_modules',
  'evidence',
  '.tmp',
  'dist',
  'coverage',
  '.turbo',
  '.vite',
]);
const paths = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relativeParts = path.relative(root, full).split(path.sep);
    if (
      relativeParts.some((part) => ignored.has(part)) ||
      /\.(zip|tsbuildinfo|log)$/u.test(relativeParts.join('/'))
    )
      continue;
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) paths.push(full);
  }
}
await walk(root);
paths.sort();
const inventory = [];
for (const file of paths) {
  const bytes = await readFile(file);
  inventory.push({
    path: path.relative(root, file).replaceAll(path.sep, '/'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
}
const fingerprint = createHash('sha256')
  .update(
    inventory
      .map((entry) => `${entry.path}\0${entry.sha256}\0${entry.bytes}\n`)
      .join(''),
  )
  .digest('hex');
await writeFile(
  'evidence/VIN-MEGA-002/i9/I9_SOURCE_INVENTORY.json',
  JSON.stringify({ fingerprint, file_count: inventory.length, inventory }, null, 2),
);
console.log(JSON.stringify({ fingerprint, file_count: inventory.length }, null, 2));
