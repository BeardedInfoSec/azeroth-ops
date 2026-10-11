param([string]$GamePath = 'C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$unLinker = Join-Path $projectRoot 'tools\oat\Unlinker.exe'
if (-not (Test-Path -LiteralPath $unLinker)) { throw 'Install OpenAssetTools v0.33.0 into tools\oat first; see README.md.' }
& $unLinker --include-assets xmodel,material,image --model-format GLB --image-format DDS --output-folder 'cache/bo2' (Join-Path $GamePath 'zone\all\common_mp.ff')
if ($LASTEXITCODE -ne 0) { throw 'BO2 export failed.' }
py -3.11 scripts/prepare-weapons.py
if ($LASTEXITCODE -ne 0) { throw 'Weapon preparation failed.' }
