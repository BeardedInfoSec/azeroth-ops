$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot 'artifacts\server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $serverId = [int](Get-Content -LiteralPath $pidFile)
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId"
    $entryPath = Join-Path $projectRoot 'scripts\server.cjs'
    if ($serverProcess -and $serverProcess.Name -eq 'node.exe' -and $serverProcess.CommandLine.Contains($entryPath)) {
        Stop-Process -Id $serverId
        Write-Output 'Azeroth Ops stopped.'
    }
}
