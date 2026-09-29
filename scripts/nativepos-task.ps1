[CmdletBinding()]
param(
  [ValidateSet("Generate", "Install", "Uninstall")]
  [string]$Mode = "Generate",
  [string]$EnvironmentFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$TaskName = "NativePOS Production Local"
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".env.production" }
$Operator = (Resolve-Path (Join-Path $PSScriptRoot "nativepos.ps1")).Path
$PowerShell = (Get-Command powershell.exe).Source
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Operator`" -Action Start -EnvironmentFile `"$EnvironmentFile`""
$action = New-ScheduledTaskAction -Execute $PowerShell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

switch ($Mode) {
  "Generate" {
    [pscustomobject]@{ TaskName = $TaskName; Trigger = "AtLogOn"; Command = $PowerShell; Arguments = $arguments; DockerRetry = "12 attempts x 5 seconds" } | ConvertTo-Json
    Write-Output "NativePOS auto-start is prepared but not installed"
  }
  "Install" {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Starts private loopback-only NativePOS after bounded Docker readiness checks" | Out-Null
    Write-Output "NativePOS auto-start task installed"
  }
  "Uninstall" {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$true
  }
}
