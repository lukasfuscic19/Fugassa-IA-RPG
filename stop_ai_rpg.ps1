$ErrorActionPreference = "Continue"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir = Join-Path $ProjectDir "startup_logs"
$StartupLog = Join-Path $LogsDir "startup.log"
$BackendPidFile = Join-Path $LogsDir "backend.pid"

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

function Write-LauncherLog {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f ([DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")), $Level, $Message
    Add-Content -Path $StartupLog -Value $line
}

function Get-ListeningPids {
    param([int]$Port)
    try {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        return @()
    }
}

Write-Host "Stopping AI RPG backend..."
Write-LauncherLog "==== SHUTDOWN BEGIN ===="

if (Test-Path $BackendPidFile) {
    try {
        $savedProcId = [int](Get-Content $BackendPidFile | Select-Object -First 1)
        if ($savedProcId) {
            Stop-Process -Id $savedProcId -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped backend PID $savedProcId"
            Write-LauncherLog "Stopped backend PID $savedProcId from pid file"
        }
    } catch {
        Write-LauncherLog "Failed stopping backend from pid file: $($_.Exception.Message)" "WARN"
    }
    Remove-Item $BackendPidFile -Force -ErrorAction SilentlyContinue
}

$pids = Get-ListeningPids -Port 3000
foreach ($procId in $pids) {
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "Stopped process on port 3000 (PID $procId)"
        Write-LauncherLog "Stopped process on port 3000 (PID $procId)"
    } catch {
        Write-LauncherLog "Failed stopping process on port 3000 (PID $procId): $($_.Exception.Message)" "WARN"
    }
}

Write-LauncherLog "==== SHUTDOWN COMPLETE ===="
