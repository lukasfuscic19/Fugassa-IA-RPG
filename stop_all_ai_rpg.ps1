$ErrorActionPreference = "Continue"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir = Join-Path $ProjectDir "startup_logs"
$StartupLog = Join-Path $LogsDir "startup.log"

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

Write-Host "Stopping AI RPG backend and LM Studio server..."
Write-LauncherLog "==== FULL SHUTDOWN BEGIN ===="

foreach ($port in @(3000, 1234)) {
    foreach ($procId in (Get-ListeningPids -Port $port)) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "Stopped process on port $port (PID $procId)"
            Write-LauncherLog "Stopped process on port $port (PID $procId)"
        } catch {
            Write-LauncherLog "Failed stopping process on port $port (PID $procId): $($_.Exception.Message)" "WARN"
        }
    }
}

Write-LauncherLog "==== FULL SHUTDOWN COMPLETE ===="
