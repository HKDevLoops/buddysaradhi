<#
.SYNOPSIS
  Registers (or removes) a Windows Scheduled Task that prunes regenerable caches.
.DESCRIPTION
  The periodic run deliberately excludes the next-build target: apps/web/.next is
  the live artefact for `next start`, and deleting it under a running server breaks
  the app. Prune that one manually with `pnpm cache:clean:apply --only next-build`
  when no server is running.
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [int]$IntervalMinutes = 30
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Buddysaradhi-CacheClean'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$SafeTargets = 'deno-lsp,node-cache,coverage,playwright'

function Get-NodePath {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw 'node not found on PATH; cannot schedule the cache cleaner' }
  return $node.Source
}

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "removed scheduled task: $TaskName"
  } else {
    Write-Output "no scheduled task named $TaskName"
  }
  exit 0
}

if (-not $Install) {
  Write-Output 'nothing to do: pass -Install to register the task, or -Uninstall to remove it'
  Write-Output "targets that will be pruned every $IntervalMinutes minute(s): $SafeTargets"
  exit 0
}

$nodeExe = Get-NodePath
$script = Join-Path $PSScriptRoot 'cache-clean.mjs'

$action = New-ScheduledTaskAction `
  -Execute $nodeExe `
  -Argument "`"$script`" --apply --only $SafeTargets" `
  -WorkingDirectory $RepoRoot

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($IntervalMinutes) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Prunes regenerable caches (.cache, node_modules/.cache, coverage, playwright) for the Buddysaradhi monorepo.' -Force | Out-Null

Write-Output "installed scheduled task: $TaskName"
Write-Output "  interval : every $IntervalMinutes minute(s)"
Write-Output "  node     : $nodeExe"
Write-Output "  workdir  : $RepoRoot"
Write-Output "  targets  : $SafeTargets"
Write-Output "  excludes : next-build (apps/web/.next may be serving a live `next start`)"