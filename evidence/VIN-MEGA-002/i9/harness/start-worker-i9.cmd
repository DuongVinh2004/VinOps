@echo off
set NODE_ENV=test
set VINOPS_LOG_LEVEL=info
set VINOPS_DATABASE_URL=postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_i2_test9
set VINOPS_WORKER_NAME=vinops-mega002-i9-worker
set VINOPS_S3_ENDPOINT=http://127.0.0.1:59060
set VINOPS_S3_REGION=us-east-1
set VINOPS_S3_BUCKET=vinops-files
set VINOPS_S3_ACCESS_KEY_ID=vinops_i6_local
set VINOPS_S3_SECRET_ACCESS_KEY=vinops-i6-local-synthetic-secret
set VINOPS_CLAMAV_HOST=127.0.0.1
set VINOPS_CLAMAV_PORT=3311
set VINOPS_FILE_JOB_POLL_INTERVAL_MS=250
cd /d "C:\Users\Duong Vinh\Downloads\VinOps\vinops"
"C:\Users\Duong Vinh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --loader "./evidence/VIN-MEGA-002/i6/harness/pg-loader.mjs" "apps/worker/dist/main.js" >> "evidence/VIN-MEGA-002/i9/worker-i9.stdout.log" 2>> "evidence/VIN-MEGA-002/i9/worker-i9.stderr.log"
