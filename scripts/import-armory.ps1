param([string]$GamePath='C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& tools/oat/Unlinker.exe --load (Join-Path $GamePath 'zone\all\common_mp.ff') --include-assets weapon --output-folder cache/bo2-patched-weapons (Join-Path $GamePath 'zone\all\common_patch_mp.ff')
if($LASTEXITCODE -ne 0){throw 'Patched BO2 weapon definition export failed'}
node scripts/import-weapon-data.cjs
if($LASTEXITCODE -ne 0){throw 'Weapon data generation failed'}
py -3.11 scripts/prepare-weapons.py
if($LASTEXITCODE -ne 0){throw 'Weapon model/scope preparation failed'}
