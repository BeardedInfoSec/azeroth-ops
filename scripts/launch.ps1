param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$address = 'http://127.0.0.1:8097'
function Test-GameReady {
    try {
        $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('Azeroth Ops')
    } catch { return $false }
}
if (-not (Test-GameReady)) {
    $nodePath = (Get-Command node.exe).Source
    $entryPath = Join-Path $projectRoot 'scripts\server.cjs'
    $logDir = Join-Path $projectRoot 'artifacts'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entryPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $logDir 'server.pid')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-GameReady) { break }
        Start-Sleep -Milliseconds 300
    }
    if (-not (Test-GameReady)) { throw 'Azeroth Ops did not start. See artifacts\server-error.log.' }
}
if (-not $NoBrowser) { Start-Process $address }
Write-Output ('Azeroth Ops is ready: ' + $address)
