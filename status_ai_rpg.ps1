$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir = Join-Path $ProjectDir "startup_logs"
$BackendPidFile = Join-Path $LogsDir "backend.pid"
$StateFile = Join-Path $LogsDir "launcher_state.json"

Write-Host "=== AI RPG Status ==="
Write-Host ""

try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/" -TimeoutSec 2
    Write-Host "Backend HTTP   : ONLINE (" $r.StatusCode ")"
} catch {
    Write-Host "Backend HTTP   : OFFLINE"
}

try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/state" -TimeoutSec 2
    Write-Host "Backend API    : ONLINE (" $r.StatusCode ")"
} catch {
    Write-Host "Backend API    : OFFLINE"
}

try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:1234/v1/models" -TimeoutSec 2
    Write-Host "LM Studio API  : ONLINE (" $r.StatusCode ")"
} catch {
    Write-Host "LM Studio API  : OFFLINE"
}

if (Test-Path $BackendPidFile) {
    try {
        $savedProcId = [int](Get-Content $BackendPidFile | Select-Object -First 1)
        $proc = Get-Process -Id $savedProcId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Backend PID    : $savedProcId (running)"
        } else {
            Write-Host "Backend PID    : $savedProcId (not found)"
        }
    } catch {
        Write-Host "Backend PID    : unreadable"
    }
} else {
    Write-Host "Backend PID    : no pid file"
}

if (Test-Path $StateFile) {
    Write-Host ""
    Write-Host "Launcher state :"
    Get-Content $StateFile | ForEach-Object { Write-Host $_ }
}

Write-Host ""
Write-Host "Logs folder: $LogsDir"
