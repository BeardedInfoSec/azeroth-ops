param([string]$GamePath = 'C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& tools/oat/Unlinker.exe --include-assets weapon --output-folder cache/bo2-fx (Join-Path $GamePath 'zone\all\common_mp.ff')
if($LASTEXITCODE -ne 0){throw 'Weapon effect reference export failed'}
foreach($zone in @('mp_nuketown_2020.ff','patch_mp.ff')){
  & tools/oat/Unlinker.exe --include-assets image,material --image-format DDS --output-folder cache/bo2-core (Join-Path $GamePath ('zone\all\'+$zone))
  if($LASTEXITCODE -ne 0){throw ('Effect image export failed: '+$zone)}
}
py -3.11 scripts/prepare-effects.py
if($LASTEXITCODE -ne 0){throw 'Effect image conversion failed'}
