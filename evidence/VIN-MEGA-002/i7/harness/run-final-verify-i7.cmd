@echo off
cd /d "C:\Users\Duong Vinh\Downloads\VinOps\vinops"
call pnpm verify > "evidence\VIN-MEGA-002\i7\pnpm-verify-i7.log" 2>&1
echo %ERRORLEVEL%> "evidence\VIN-MEGA-002\i7\pnpm-verify-i7.exit"
