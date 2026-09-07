$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Duong Vinh\Downloads\VinOps\vinops'
$i11 = Join-Path $repo 'evidence\VIN-MEGA-002\i11'
$taskLabel = 'VIN-MEGA-002'
$containerNames = @('vinops-mega002-i6-clamav','vinops-mega002-i6-minio','vinops-mega002-i6-postgres')
$networkNames = @('vinops-mega002-i6-runtime')
$volumeNames = @('vinops-mega002-i6-minio-data','vinops-mega002-i6-postgres-data')
$databaseNames = @('vinops_mega002_i2_test9','vinops_mega002_i6_test','vinops_mega002_i8_test','vinops_mega002_test')
$filesystemNames = @(
  'vinops-mega002-i2-cleanroom','vinops-mega002-i2-current-source','corepack.cmd',
  'i2-api.err.log','i2-api.out.log','i2-api2.err.log','i2-api2.out.log',
  'i2-web.err.log','i2-web.out.log','i2-web2.err.log','i2-web2.out.log','i2-web3.err.log','i2-web3.out.log',
  'vinops-mega002-i1-proxy.mjs','vinops-mega002-i2-benchmark.mjs','vinops-mega002-i2-browser-api.mjs',
  'vinops-mega002-i2-evidence.mjs','vinops-mega002-i2-faults-auth.mjs','vinops-mega002-i3-api.pid',
  'vinops-mega002-i3-authz-matrix.mjs','vinops-mega002-i3-browser-evidence.mjs','vinops-mega002-i3-package.mjs',
  'vinops-mega002-i3-per-client-benchmark.mjs','vinops-mega002-i3-web.pid','vinops-mega002-i4-browser-api-4177.mjs',
  'vinops-mega002-i4-browser-api-4178.mjs','vinops-mega002-i4-browser-api-4179.mjs',
  'vinops-mega002-i4-browser-api-4180.mjs','vinops-mega002-i4-browser-api.mjs','vinops-mega002-i4-capture.mjs',
  'vinops-mega002-i4-diagnostics.mjs','vinops-mega002-i4-package.py','vinops-mega002-i4-web.cmd'
)
function TaskProcesses {
  $all = @(Get-CimInstance Win32_Process)
  $seed = @($all | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and
    ($_.CommandLine -match 'vinops-mega002' -or $_.CommandLine -match 'evidence[\\/]VIN-MEGA-002')
  })
  $parents = @($seed.ProcessId)
  $children = @($all | Where-Object {
    $_.CommandLine -and $_.ParentProcessId -in $parents -and
    $_.CommandLine -match 'apps[\\/](api|worker)[\\/]dist[\\/]main\.js'
  })
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
$tmpRoot = [IO.Path]::GetFullPath((Join-Path $repo '.tmp'))
$filesystem = @()
foreach ($name in $filesystemNames) {
  $target = [IO.Path]::GetFullPath((Join-Path $tmpRoot $name))
  if (-not $target.StartsWith($tmpRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe target: $target" }
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse target refused: $target" }
    $filesystem += $target
  }
}
$processes = @(TaskProcesses)
$unrelatedBefore = @{
  containers = @(docker ps -a --format '{{.ID}} {{.Names}}' | Where-Object { $_ -notmatch 'vinops-mega002' })
  networks = @(docker network ls --format '{{.ID}} {{.Name}}' | Where-Object { $_ -notmatch 'vinops-mega002' })
  volumes = @(docker volume ls --format '{{.Name}}' | Where-Object { $_ -notmatch 'vinops-mega002' })
}
$pre = @{
  task = $taskLabel; containers = $containerNames; networks = $networkNames; volumes = $volumeNames;
  databases = $databaseNames; processes = @($processes | Select-Object ProcessId,ParentProcessId,Name,CommandLine);
  filesystem_targets = $filesystem; authorization = 'direct user destructive confirmation for VIN-MEGA-002 task-owned inventory';
  no_prune = $true; images_targeted = 0
}
$pre | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $i11 'PRE_CLEANUP_INVENTORY.json') -Encoding UTF8
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
foreach ($target in $filesystem) {
  $item = Get-Item -LiteralPath $target -Force
  if ($item.PSIsContainer) { Remove-Item -LiteralPath $target -Recurse -Force }
  else { Remove-Item -LiteralPath $target -Force }
}
$remainingProcesses = @(TaskProcesses)
$remainingContainers = @(docker ps -a --filter "label=vinops.task=$taskLabel" --format '{{.Names}}')
$remainingNetworks = @(docker network ls --filter "label=vinops.task=$taskLabel" --format '{{.Name}}')
$remainingVolumes = @(docker volume ls --filter "label=vinops.task=$taskLabel" --format '{{.Name}}')
$remainingFilesystem = @($filesystem | Where-Object { Test-Path -LiteralPath $_ })
$unrelatedAfter = @{
  containers = @(docker ps -a --format '{{.ID}} {{.Names}}' | Where-Object { $_ -notmatch 'vinops-mega002' })
  networks = @(docker network ls --format '{{.ID}} {{.Name}}' | Where-Object { $_ -notmatch 'vinops-mega002' })
  volumes = @(docker volume ls --format '{{.Name}}' | Where-Object { $_ -notmatch 'vinops-mega002' })
}
$post = @{
  status = if ($remainingProcesses.Count + $remainingContainers.Count + $remainingNetworks.Count + $remainingVolumes.Count + $remainingFilesystem.Count -eq 0) { 'PASS' } else { 'FAIL' };
  removed = @{ processes=$processes.Count; databases=$databaseNames.Count; containers=$containerNames.Count; networks=$networkNames.Count; volumes=$volumeNames.Count; filesystem=$filesystem.Count };
  remaining = @{ processes=$remainingProcesses.Count; containers=$remainingContainers.Count; networks=$remainingNetworks.Count; volumes=$remainingVolumes.Count; filesystem=$remainingFilesystem.Count };
  unrelated_unchanged = (ConvertTo-Json $unrelatedBefore -Depth 5 -Compress) -eq (ConvertTo-Json $unrelatedAfter -Depth 5 -Compress);
  source_preserved = Test-Path -LiteralPath (Join-Path $repo 'package.json'); evidence_i1_i11_preserved = Test-Path -LiteralPath $i11;
  docker_prune_used = $false; images_removed = 0; exact_targets_only = $true
}
$post | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $i11 'POST_CLEANUP_PROOF.json') -Encoding UTF8
$post | ConvertTo-Json -Depth 8
if ($post.status -ne 'PASS' -or -not $post.unrelated_unchanged) { exit 1 }
