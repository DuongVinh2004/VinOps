@echo off
cd /d "C:\Users\Duong Vinh\Downloads\VinOps\vinops"
"C:\Users\Duong Vinh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --loader "./evidence/VIN-MEGA-002/i7/harness/pg-loader.mjs" "./evidence/VIN-MEGA-002/i7/harness/run-authz-i7.mjs" > "./evidence/VIN-MEGA-002/i7/runner-i7.stdout.log" 2> "./evidence/VIN-MEGA-002/i7/runner-i7.stderr.log"
