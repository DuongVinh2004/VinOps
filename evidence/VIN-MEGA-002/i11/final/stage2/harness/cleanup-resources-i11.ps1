$ErrorActionPreference = 'Stop'
$taskLabel = 'VIN-MEGA-002'
$containerNames = @('vinops-mega002-i6-clamav','vinops-mega002-i6-minio','vinops-mega002-i6-postgres')
$networkNames = @('vinops-mega002-i6-runtime')
$volumeNames = @('vinops-mega002-i6-minio-data','vinops-mega002-i6-postgres-data')
$databaseNames = @('vinops_mega002_i2_test9','vinops_mega002_i6_test','vinops_mega002_i8_test','vinops_mega002_test')
function TaskProcesses {
  $all = @(Get-CimInstance Win32_Process)
  $seed = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -match 'vinops-mega002' -or $_.CommandLine -match 'evidence[\\/]VIN-MEGA-002') })
  $parents = @($seed.ProcessId)
  $children = @($all | Where-Object { $_.CommandLine -and $_.ParentProcessId -in $parents -and $_.CommandLine -match 'apps[\\/](api|worker)[\\/]dist[\\/]main\.js' })
  @($seed + $children | Sort-Object ProcessId -Unique)
}
foreach ($name in $containerNames) {
  $labels = docker inspect --format '{{json .Config.Labels}}' $name | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $labels.'vinops.task' -ne $taskLabel) { throw "Container ownership failed: $name" }
}
foreach ($name in $networkNames) {
  $labels = docker network inspect --format '{{json .Labels}}' $name | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $labels.'vinops.task' -ne $taskLabel) { throw "Network ownership failed: $name" }
}
foreach ($name in $volumeNames) {
  $labels = docker volume inspect --format '{{json .Labels}}' $name | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $labels.'vinops.task' -ne $taskLabel) { throw "Volume ownership failed: $name" }
}
$actualDatabases = @(docker exec vinops-mega002-i6-postgres psql -U postgres -d postgres -At -c "SELECT datname FROM pg_database WHERE datname LIKE 'vinops_mega002%' ORDER BY datname;")
if (@(Compare-Object $databaseNames $actualDatabases).Count -ne 0) { throw 'Database target set changed.' }
$processes = @(TaskProcesses)
$processes | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\Users\Duong Vinh\Downloads\VinOps\vinops\evidence\VIN-MEGA-002\i11\RESOURCE_PROCESS_PRE.json' -Encoding UTF8
foreach ($process in $processes) {
  $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)" -ErrorAction SilentlyContinue
  if ($null -ne $live -and $live.CommandLine -eq $process.CommandLine) { Stop-Process -Id $process.ProcessId -Force }
}
Start-Sleep -Milliseconds 500
foreach ($database in $databaseNames) {
  docker exec vinops-mega002-i6-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$database' AND pid <> pg_backend_pid();" | Out-Null
  docker exec vinops-mega002-i6-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE `"$database`";" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Database drop failed: $database" }
}
foreach ($name in $containerNames) { docker rm --force $name | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Container removal failed: $name" } }
foreach ($name in $networkNames) { docker network rm $name | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Network removal failed: $name" } }
foreach ($name in $volumeNames) { docker volume rm $name | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Volume removal failed: $name" } }
$remainingProcesses = @(TaskProcesses)
$remainingContainers = @(docker ps -a --filter "label=vinops.task=$taskLabel" --format '{{.Names}}')
$remainingNetworks = @(docker network ls --filter "label=vinops.task=$taskLabel" --format '{{.Name}}')
$remainingVolumes = @(docker volume ls --filter "label=vinops.task=$taskLabel" --format '{{.Name}}')
$proof = @{
  status = if ($remainingProcesses.Count + $remainingContainers.Count + $remainingNetworks.Count + $remainingVolumes.Count -eq 0) { 'PASS' } else { 'FAIL' }
  removed = @{ processes=$processes.Count; databases=$databaseNames.Count; containers=$containerNames.Count; networks=$networkNames.Count; volumes=$volumeNames.Count }
  remaining = @{ processes=$remainingProcesses.Count; containers=$remainingContainers.Count; networks=$remainingNetworks.Count; volumes=$remainingVolumes.Count }
  filesystem_cleanup = 'BLOCKED_BY_GLOBAL_UNTRACKED_FILE_PROHIBITION'
  docker_prune_used = $false
  images_removed = 0
}
$proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath 'C:\Users\Duong Vinh\Downloads\VinOps\vinops\evidence\VIN-MEGA-002\i11\RESOURCE_CLEANUP_PROOF.json' -Encoding UTF8
$proof | ConvertTo-Json -Depth 8
if ($proof.status -ne 'PASS') { exit 1 }
