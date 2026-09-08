import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const composeFile = 'docker-compose.test.yml';

let exitCode = 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

try {
  console.log('[test:integration] Starting clean-room test infrastructure...');
  const upCode = run('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait']);
  if (upCode !== 0) {
    throw new Error(`[test:integration] Failed to bring up test infra (code ${upCode})`);
  }

  console.log('[test:integration] Running test database migrations...');
  const migrateCode = run('pnpm', ['test:migrate']);
  if (migrateCode !== 0) {
    throw new Error(`[test:integration] Migration failed (code ${migrateCode})`);
  }

  console.log('[test:integration] Executing test suite...');
  const customArgs = process.argv.slice(2);
  const testArgs = customArgs.length > 0 ? customArgs : ['tests'];

  const testEnv = {
    ...process.env,
    VINOPS_TEST_DATABASE_URL:
      'postgresql://postgres:fixture-postgres-password@127.0.0.1:5432/vinops_mega001_test',
    VINOPS_TEST_APP_DATABASE_URL:
      'postgresql://vinops_app_user:fixture-vinops-password@127.0.0.1:5432/vinops_mega001_test',
    VINOPS_TEST_WORKER_ADMIN_DATABASE_URL:
      'postgresql://postgres:fixture-postgres-password@127.0.0.1:5432/vinops_mega001_i4_worker_test',
    VINOPS_TEST_WORKER_DATABASE_URL:
      'postgresql://vinops_worker_user:fixture-vinops-password@127.0.0.1:5432/vinops_mega001_i4_worker_test',
    VINOPS_TEST_S3_ENDPOINT: 'http://127.0.0.1:9000',
    VINOPS_TEST_S3_BUCKET: 'vinops-files',
    VINOPS_TEST_S3_ACCESS_KEY_ID: 'minioadmin',
    VINOPS_TEST_S3_SECRET_ACCESS_KEY: 'minioadmin',
    VINOPS_TEST_CLAMAV_HOST: '127.0.0.1',
    VINOPS_TEST_CLAMAV_PORT: '3310',
    VINOPS_MALWARE_TEST_B64:
      'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
    VINOPS_TEST_AUTH_TOKEN_SECRET: 'fixture-auth-token-secret-0123456789012345',
    VINOPS_TEST_USER_PASSWORD: 'fixture-user-password-12345',
  };

  const testCode = run('pnpm', ['vitest', 'run', ...testArgs], { env: testEnv });
  exitCode = testCode;
} catch (error) {
  console.error('[test:integration] Execution error:', error);
  exitCode = 1;
} finally {
  console.log('[test:integration] Tearing down test infrastructure and volumes...');
  const downCode = run('docker', ['compose', '-f', composeFile, 'down', '-v']);
  if (downCode !== 0 && exitCode === 0) {
    exitCode = downCode;
  }
}

process.exit(exitCode);
