# Full copy of the repo into a short build root (see build-android-local.sh for why).
# Excludes only these exact directories; note robocopy /XD matches by NAME unless given a full path.
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Destination)) { New-Item -ItemType Directory -Force -Path $Destination | Out-Null }
Write-Output "[sync] full copy -> $Destination"
robocopy $Source $Destination /E /MT:32 /XD "$Source\.git" "$Source\_scratch" "$Source\android" "$Source\ios" /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
# robocopy exit codes 0-7 all mean success
if ($LASTEXITCODE -gt 7) { Write-Error ("robocopy failed: " + $LASTEXITCODE) }
exit 0
