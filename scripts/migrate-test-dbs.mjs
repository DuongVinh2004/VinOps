import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const migrateScript = path.join(repositoryRoot, 'packages', 'database', 'dist', 'migrate.js');

const dbs = [
  'vinops_chat1_test',
  'vinops_chat2_test',
  'vinops_chat3_test',
  'vinops_mega001_test',
  'vinops_mega001_i4_worker_test',
  'vinops_mega002_i1_test',
  'vinops_mega002_i2_test',
];

const host = process.env.PGHOST ?? '127.0.0.1';
const port = process.env.PGPORT ?? '5432';
const user = process.env.PGUSER ?? 'postgres';
const pass = process.env.PGPASSWORD ?? 'postgres';

for (const db of dbs) {
  const url = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
  console.log(`Migrating database ${db}...`);
  execFileSync(process.execPath, [migrateScript], {
    env: { ...process.env, VINOPS_DATABASE_URL: url },
    stdio: 'inherit',
  });
}
console.log('All test databases successfully migrated.');
