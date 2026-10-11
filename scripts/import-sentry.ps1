param([string]$GamePath = 'C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II', [switch]$Export)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
# The scorestreak sentry gun (t6_wpn_turret_sentry_gun) lives in common_mp.ff.
# By default reuse a model already present in the bounded cache/bo2 export from
# import-bo2.ps1. Pass -Export to link a tiny zone containing only that named
# model and export it to cache/bo2-sentry. Run strictly one tool at a time; the
# game folder is read-only.
$source = 'cache/bo2'
if ($Export -or -not (Test-Path -LiteralPath 'cache/bo2/model_export/t6_wpn_turret_sentry_gun_lod0.glb')) {
  $linker = Join-Path $projectRoot 'tools\oat\Linker.exe'
  $unlinker = Join-Path $projectRoot 'tools\oat\Unlinker.exe'
  $zoneRoot = Join-Path $GamePath 'zone\all'
  $selectedRoot = Join-Path $projectRoot 'cache\bo2-sentry-selected'
  $sourceRoot = Join-Path $selectedRoot 'zone_source'
  New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
  @('>game,T6', 'xmodel,t6_wpn_turret_sentry_gun') | Set-Content -LiteralPath (Join-Path $sourceRoot 'sentry_selected.zone') -Encoding ascii
  & $linker --base-folder $selectedRoot --load (Join-Path $zoneRoot 'common_mp.ff') sentry_selected
  if ($LASTEXITCODE -ne 0) { throw 'Named sentry selection failed.' }
  $selectedZone = Join-Path $selectedRoot 'zone_out\sentry_selected\sentry_selected.ff'
  & $unlinker --include-assets xmodel,material,image --model-format GLB --image-format DDS --search-path $zoneRoot --output-folder 'cache/bo2-sentry' $selectedZone
  if ($LASTEXITCODE -ne 0) { throw 'Named sentry export failed.' }
  $source = 'cache/bo2-sentry'
}
py -3.11 scripts/prepare-sentry.py --source $source
if ($LASTEXITCODE -ne 0) { throw 'Sentry preparation failed.' }
