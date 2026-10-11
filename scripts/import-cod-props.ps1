param([string]$GamePath = 'C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$linker = Join-Path $projectRoot 'tools\oat\Linker.exe'
$unlinker = Join-Path $projectRoot 'tools\oat\Unlinker.exe'
$zoneRoot = Join-Path $GamePath 'zone\all'
$selectedRoot = Join-Path $projectRoot 'cache\bo2-selected'
$sourceRoot = Join-Path $selectedRoot 'zone_source'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
# Link a tiny intermediate zone from only these named models and dependencies.
# This avoids exporting the entire Zombies maps. The game folder is read-only.
$selections = [ordered]@{
  zm_transit = @('zombie_vending_jugg_on','zombie_vending_revive_on','zombie_vending_doubletap2_on','zombie_vending_sleight_on','zombie_vending_marathon_on','zombie_vending_tombstone_on','p6_anim_zm_buildable_pap_on')
  zm_prison = @('p6_zm_al_vending_ads_on','p6_zm_al_vending_nuke_on','p6_zm_vending_electric_cherry_on')
  zm_buried = @('zombie_vending_three_gun_on','p6_zm_vending_vultureaid_on')
  zm_highrise = @('p6_zm_vending_chugabud_on')
}
$imagePacks = @{zm_transit='zm';zm_prison='dlczm2';zm_buried='dlczm3';zm_highrise='dlczm1'}
foreach ($entry in $selections.GetEnumerator()) {
  $project = 'props_' + $entry.Key
  $definition = @('>game,T6',('>level.ipak_read,' + $imagePacks[$entry.Key])) + @($entry.Value | ForEach-Object { 'xmodel,' + $_ })
  $definition | Set-Content -LiteralPath (Join-Path $sourceRoot ($project + '.zone')) -Encoding ascii
  & $linker --base-folder $selectedRoot --load (Join-Path $zoneRoot ($entry.Key + '.ff')) $project
  if ($LASTEXITCODE -ne 0) { throw ('Named model selection failed: ' + $entry.Key) }
  $selectedZone = Join-Path $selectedRoot ('zone_out\' + $project + '\' + $project + '.ff')
  & $unlinker --include-assets xmodel,material,image --model-format GLB --image-format DDS --search-path $zoneRoot --output-folder ('cache/bo2-machines-' + $entry.Key) $selectedZone
  if ($LASTEXITCODE -ne 0) { throw ('Named model export failed: ' + $entry.Key) }
}
py -3.11 scripts/prepare-cod-props.py
if ($LASTEXITCODE -ne 0) { throw 'COD prop preparation failed.' }
