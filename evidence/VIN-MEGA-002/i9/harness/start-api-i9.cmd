@echo off
set NODE_ENV=test
set VINOPS_LOG_LEVEL=info
set VINOPS_API_HOST=127.0.0.1
set VINOPS_API_PORT=4620
set VINOPS_DATABASE_URL=postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_i2_test9
set VINOPS_AUTH_TOKEN_SECRET=vinops-mega002-i9-auth-secret-0123456789
set VINOPS_ALLOWED_ORIGINS=http://127.0.0.1:4621
set VINOPS_ACCESS_TOKEN_TTL_SECONDS=900
set VINOPS_REFRESH_IDLE_TTL_DAYS=7
set VINOPS_REFRESH_ABSOLUTE_TTL_DAYS=30
set VINOPS_AUTH_RATE_LIMIT_WINDOW_SECONDS=900
set VINOPS_AUTH_RATE_LIMIT_MAX_ATTEMPTS=100
set VINOPS_REFRESH_COOKIE_SECURE=false
set VINOPS_S3_ENDPOINT=http://127.0.0.1:59060
set VINOPS_S3_REGION=us-east-1
set VINOPS_S3_BUCKET=vinops-files
set VINOPS_S3_ACCESS_KEY_ID=vinops_i6_local
set VINOPS_S3_SECRET_ACCESS_KEY=vinops-i6-local-synthetic-secret
set VINOPS_SIGNED_URL_TTL_SECONDS=60
set VINOPS_CLAMAV_HOST=127.0.0.1
set VINOPS_CLAMAV_PORT=3311
cd /d "C:\Users\Duong Vinh\Downloads\VinOps\vinops"
"C:\Users\Duong Vinh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --loader "./evidence/VIN-MEGA-002/i6/harness/pg-loader.mjs" "apps/api/dist/main.js" >> "evidence/VIN-MEGA-002/i9/api-i9.stdout.log" 2>> "evidence/VIN-MEGA-002/i9/api-i9.stderr.log"
