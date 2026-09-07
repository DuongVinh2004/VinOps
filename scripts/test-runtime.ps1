# VinOps Runtime Integration Test Runner
$ErrorActionPreference = "Stop"

$pgHost = "127.0.0.1:5432"
$pgAdminUser = "postgres"
$pgAdminPass = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "postgres" }
$pgAppUser = "vinops_app"
$pgAppPass = "vinops_app_password"
$pgWorkerUser = "vinops_worker"
$pgWorkerPass = "vinops_worker_password"

function Build-PgUri($user, $pass, $db) {
    return "postgres" + "ql://" + $user + ":" + $pass + "@" + $pgHost + "/" + $db
}

Write-Host "==> Applying migrations across all test databases..." -ForegroundColor Cyan
$adminConnPrefix = Build-PgUri $pgAdminUser $pgAdminPass ""
node -e "
import { runMigrations } from './packages/database/dist/index.js';
const dbs = [
  'vinops_mega001_test',
  'vinops_mega001_i4_worker_test',
  'vinops_mega002_i1_test',
  'vinops_mega002_i2_test'
];
for (const db of dbs) {
  await runMigrations('$adminConnPrefix' + db);
  console.log('Migrated ' + db);
}
"

# Set baseline S3 and ClamAV environment
$env:VINOPS_TEST_S3_ENDPOINT = "http://127.0.0.1:9000"
$env:VINOPS_TEST_S3_BUCKET = "vinops-files"
$env:VINOPS_TEST_S3_ACCESS_KEY_ID = "minioadmin"
$env:VINOPS_TEST_S3_SECRET_ACCESS_KEY = "minioadmin"
$env:VINOPS_TEST_CLAMAV_HOST = "127.0.0.1"
$env:VINOPS_TEST_CLAMAV_PORT = "3310"
$env:VINOPS_MALWARE_TEST_B64 = "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo="
$env:VINOPS_TEST_AUTH_TOKEN_SECRET = "fixture-auth-token-secret-0123456789012345"
$env:VINOPS_TEST_USER_PASSWORD = "fixture-user-password-12345"

Write-Host "`n==> 1. Running S3 & ClamAV Runtime Tests..." -ForegroundColor Green
pnpm vitest run packages/file/test/file-runtime.integration.test.ts

Write-Host "`n==> 2. Running MEGA-001 PostgreSQL Integration Tests..." -ForegroundColor Green
$env:VINOPS_TEST_DATABASE_URL = Build-PgUri $pgAdminUser $pgAdminPass "vinops_mega001_test"
pnpm vitest run packages/database/test/postgres.integration.test.ts

Write-Host "`n==> 3. Running MEGA-002 Document PostgreSQL Invariants..." -ForegroundColor Green
$env:VINOPS_TEST_DATABASE_URL = Build-PgUri $pgAdminUser $pgAdminPass "vinops_mega002_i1_test"
pnpm vitest run packages/database/test/document-postgres.integration.test.ts

Write-Host "`n==> 4. Running Worker Outbox Runtime Tests..." -ForegroundColor Green
$env:VINOPS_TEST_WORKER_ADMIN_DATABASE_URL = Build-PgUri $pgAdminUser $pgAdminPass "vinops_mega001_i4_worker_test"
$env:VINOPS_TEST_WORKER_DATABASE_URL = Build-PgUri $pgWorkerUser $pgWorkerPass "vinops_mega001_i4_worker_test"
pnpm vitest run apps/worker/test/postgres-runtime.integration.test.ts

Write-Host "`n==> 5. Running Worker File Processing Runtime Tests..." -ForegroundColor Green
$env:VINOPS_TEST_DATABASE_URL = Build-PgUri $pgAdminUser $pgAdminPass "vinops_mega002_i2_test"
pnpm vitest run apps/worker/test/file-processing.integration.test.ts

Write-Host "`n==> 6. Running Live API Security Runtime Tests..." -ForegroundColor Green
$env:VINOPS_TEST_DATABASE_URL = Build-PgUri $pgAdminUser $pgAdminPass "vinops_mega001_test"
$env:VINOPS_TEST_APP_DATABASE_URL = Build-PgUri $pgAppUser $pgAppPass "vinops_mega001_test"
pnpm vitest run apps/api/test/runtime-security.integration.test.ts

Write-Host "`n==> ALL RUNTIME INTEGRATION SUITES PASSED!" -ForegroundColor Cyan
