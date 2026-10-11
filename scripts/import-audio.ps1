param([string]$GamePath='C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
# The common weapon bank references samples registered by code_post_gfx_mp.
# Preloading it is required; dumping common_mp alone leaves missing recordings.
& tools/oat/Unlinker.exe --load (Join-Path $GamePath 'zone\all\code_post_gfx_mp.ff') --include-assets soundbank --output-folder cache/bo2-audio (Join-Path $GamePath 'zone\all\common_mp.ff')
if($LASTEXITCODE -ne 0){throw 'Original BO2 sound bank export failed'}
py -3.11 scripts/prepare-audio.py --game-path $GamePath
if($LASTEXITCODE -ne 0){throw 'Original BO2 weapon sound preparation failed'}
