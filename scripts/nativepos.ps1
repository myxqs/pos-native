[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet("Build", "Migrate", "Start", "Stop", "Restart", "Status", "Logs", "Backup", "Restore")]
  [string]$Action,
  [string]$EnvironmentFile,
  [string]$ProjectName = "nativepos-production",
  [string]$BackupId,
  [string]$RecoveryDatabase,
  [switch]$ConfirmRestore,
  [int]$MaxDockerAttempts = 12,
  [int]$DockerRetrySeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $RepositoryRoot ".env.production" }
$ComposeFile = Join-Path $RepositoryRoot "compose.production.yaml"

function Invoke-External([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

function Wait-Docker {
  for ($attempt = 1; $attempt -le $MaxDockerAttempts; $attempt++) {
    & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $MaxDockerAttempts) { Start-Sleep -Seconds $DockerRetrySeconds }
  }
  throw "Docker did not become ready within the bounded startup window"
}

function Get-Environment {
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
    throw "NativePOS production environment file is unavailable"
  }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    if ($line -match '^\s*#' -or -not $line.Trim()) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $values[$parts[0].Trim()] = $parts[1].Trim() }
  }
  foreach ($name in @('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POS_SERVICE_TOKEN', 'POS_BACKUP_ROOT')) {
    if (-not $values.ContainsKey($name) -or $values[$name] -match '^replace-with-') {
      throw "NativePOS production environment is incomplete"
    }
  }
  return $values
}

function Compose([string[]]$Arguments) {
  $composeArguments = @('compose', '--project-name', $ProjectName, '--env-file', $EnvironmentFile, '--file', $ComposeFile) + $Arguments
  Invoke-External docker $composeArguments
}

function Start-NativePOS {
  Wait-Docker
  Get-Environment | Out-Null
  Compose @('build', 'app', 'migrate')
  Compose @('up', '-d', 'postgres')
  Compose @('--profile', 'tools', 'run', '--rm', 'migrate')
  Compose @('up', '-d', 'app')
}

function Get-ContainerId([string]$Service) {
  $id = (& docker compose --project-name $ProjectName --env-file $EnvironmentFile --file $ComposeFile ps -q $Service).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $id) { throw "NativePOS service container is unavailable" }
  return $id
}

function Invoke-Backup {
  $environment = Get-Environment
  $backupRoot = [IO.Path]::GetFullPath($environment.POS_BACKUP_ROOT)
  [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
  $temporary = Join-Path ([IO.Path]::GetTempPath()) ("nativepos-backup-" + [guid]::NewGuid())
  $assetCopy = Join-Path $temporary 'assets'
  [IO.Directory]::CreateDirectory($assetCopy) | Out-Null
  try {
    $app = Get-ContainerId 'app'
    $postgres = Get-ContainerId 'postgres'
    Invoke-External docker @('cp', "${app}:/var/lib/nativepos/assets/.", $assetCopy) # docker cp preserves canonical asset bytes
    Invoke-External npm @('run', 'build')
    $output = & node (Join-Path $RepositoryRoot 'scripts\postgres-recovery.mjs') backup --container $postgres --database $environment.POSTGRES_DB --user $environment.POSTGRES_USER --asset-root $assetCopy --backup-root $backupRoot --max-bytes 1073741824 --schema-version 0011 --application-version 0.1.0
    if ($LASTEXITCODE -ne 0) { throw "NativePOS backup failed" }
    $result = $output | Select-Object -Last 1 | ConvertFrom-Json
    $retention = if ($environment.POS_BACKUP_RETENTION -match '^\d+$') { [int]$environment.POS_BACKUP_RETENTION } else { 14 }
    if ($retention -lt 1 -or $retention -gt 365) { throw "NativePOS backup retention is invalid" }
    $old = Get-ChildItem -LiteralPath $backupRoot -Directory | Where-Object Name -Match '^backup-[0-9a-f-]{36}$' | Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip $retention
    foreach ($directory in $old) {
      if ([IO.Path]::GetFullPath($directory.Parent.FullName) -ne $backupRoot) { throw "NativePOS backup retention target is unsafe" }
      Remove-Item -LiteralPath $directory.FullName -Recurse -Force
    }
    $result | ConvertTo-Json -Compress
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  }
}

function Invoke-Restore {
  if (-not $ConfirmRestore -or $BackupId -notmatch '^[0-9a-f]{8}-[0-9a-f-]{27}$' -or $RecoveryDatabase -notmatch '^pos_native_recovery_[a-z0-9_]+$') {
    throw "Restore requires ConfirmRestore, a backup UUID, and a pos_native_recovery_ database"
  }
  $environment = Get-Environment
  if ($RecoveryDatabase -eq $environment.POSTGRES_DB) { throw "Production database restore is prohibited by this operator" }
  $postgres = Get-ContainerId 'postgres'
  Invoke-External docker @('exec', $postgres, 'createdb', '--username', $environment.POSTGRES_USER, '--owner', $environment.POSTGRES_USER, $RecoveryDatabase)
  $assetTarget = Join-Path ([IO.Path]::GetFullPath($environment.POS_BACKUP_ROOT)) ("restore-" + $BackupId)
  [IO.Directory]::CreateDirectory($assetTarget) | Out-Null
  Invoke-External npm @('run', 'build')
  Invoke-External node @((Join-Path $RepositoryRoot 'scripts\postgres-recovery.mjs'), 'restore', '--container', $postgres, '--database', $RecoveryDatabase, '--user', $environment.POSTGRES_USER, '--asset-root', $assetTarget, '--backup-root', $environment.POS_BACKUP_ROOT, '--backup-id', $BackupId, '--max-bytes', '1073741824')
  $volume = "${ProjectName}-${RecoveryDatabase}-asset-data"
  Invoke-External docker @('volume', 'create', $volume)
  $image = (& docker compose --project-name $ProjectName --env-file $EnvironmentFile --file $ComposeFile images -q app).Trim()
  if (-not $image) { throw "NativePOS application image is unavailable" }
  Invoke-External docker @('run', '--rm', '--user', '0', '--volume', "${volume}:/target", '--volume', "${assetTarget}:/source:ro", $image, 'sh', '-c', 'cp -a /source/. /target/')
  [pscustomobject]@{ database = $RecoveryDatabase; assetVolume = $volume; backupId = $BackupId } | ConvertTo-Json -Compress
}

Wait-Docker
switch ($Action) {
  'Build' { Compose @('build', 'app', 'migrate') }
  'Migrate' { Get-Environment | Out-Null; Compose @('up', '-d', 'postgres'); Compose @('--profile', 'tools', 'run', '--rm', 'migrate') }
  'Start' { Start-NativePOS }
  'Stop' { Compose @('down') }
  'Restart' { Compose @('down'); Start-NativePOS }
  'Status' { Compose @('ps') }
  'Logs' { Compose @('logs', '--tail', '200', 'app', 'postgres') }
  'Backup' { Invoke-Backup }
  'Restore' { Invoke-Restore }
}
