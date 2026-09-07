@echo off
cd /d "C:\Users\Duong Vinh\Downloads\VinOps\vinops"
"C:\Users\Duong Vinh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --loader "./evidence/VIN-MEGA-002/i6/harness/pg-loader.mjs" "./evidence/VIN-MEGA-002/i6/harness/run-authz-i6.mjs" >> "evidence/VIN-MEGA-002/i6/runner-i6.stdout.log" 2>> "evidence/VIN-MEGA-002/i6/runner-i6.stderr.log"
