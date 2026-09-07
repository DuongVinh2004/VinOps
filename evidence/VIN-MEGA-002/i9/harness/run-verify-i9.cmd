@echo off
set PATH=C:\Users\Duong Vinh\Downloads\VinOps\vinops\.tmp;C:\Users\Duong Vinh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\Duong Vinh\AppData\Roaming\npm;%PATH%
cd /d "C:\Users\Duong Vinh\Downloads\VinOps\vinops"
"C:\Users\Duong Vinh\AppData\Roaming\npm\pnpm.cmd" verify > "evidence\VIN-MEGA-002\i9\pnpm-verify-i9.stdout.log" 2> "evidence\VIN-MEGA-002\i9\pnpm-verify-i9.stderr.log"
exit /b %ERRORLEVEL%
