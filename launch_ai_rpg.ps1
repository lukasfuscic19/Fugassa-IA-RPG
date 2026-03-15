$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir = Join-Path $ProjectDir "startup_logs"
$StartupLog = Join-Path $LogsDir "startup.log"
$BackendOut = Join-Path $LogsDir "backend.stdout.log"
$BackendErr = Join-Path $LogsDir "backend.stderr.log"
$LauncherErr = Join-Path $LogsDir "launcher.errors.log"
$StateFile = Join-Path $LogsDir "launcher_state.json"
$BackendPidFile = Join-Path $LogsDir "backend.pid"

$ModelName = "qwen3.5-9b-uncensored-hauhaucs-aggressive"
$ContextLength = 16000
$BackendHealthUrl = "http://localhost:3000/"

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

function Write-LauncherLog {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f ([DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")), $Level, $Message
    Add-Content -Path $StartupLog -Value $line
}

function Write-LauncherError {
    param([string]$Message)
    $line = "[{0}] [ERROR] {1}" -f ([DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")), $Message
    Add-Content -Path $LauncherErr -Value $line
}

function Save-LauncherState {
    param([hashtable]$State)
    ($State | ConvertTo-Json -Depth 5) | Set-Content -Path $StateFile -Encoding UTF8
}

function Test-HttpUp {
    param([string]$Url, [int]$TimeoutSec = 2)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Wait-HttpUp {
    param([string]$Url, [int]$Retries = 60, [int]$DelayMs = 1000)
    for ($i = 0; $i -lt $Retries; $i++) {
        if (Test-HttpUp -Url $Url) { return $true }
        Start-Sleep -Milliseconds $DelayMs
    }
    return $false
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

function Stop-ProcessesOnPort {
    param([int]$Port)
    foreach ($procId in (Get-ListeningPids -Port $Port)) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-LauncherLog "Stopped process on port $Port (PID $procId)"
        } catch {
            Write-LauncherLog "Failed stopping process on port $Port (PID $procId): $($_.Exception.Message)" "WARN"
        }
    }
}

function Get-LmsPath {
    try {
        return (Get-Command lms -ErrorAction Stop).Source
    } catch {
        return $null
    }
}

function Invoke-Lms {
    param(
        [string]$LmsPath,
        [string[]]$Arguments,
        [string]$Label
    )

    Write-LauncherLog ("Running: lms " + ($Arguments -join " "))

    $stdoutFile = Join-Path $LogsDir ("tmp_" + $Label + ".stdout.log")
    $stderrFile = Join-Path $LogsDir ("tmp_" + $Label + ".stderr.log")

    Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue

    $proc = Start-Process -FilePath $LmsPath `
        -ArgumentList $Arguments `
        -WorkingDirectory $ProjectDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile `
        -PassThru `
        -Wait

    $stdout = $null
    $stderr = $null

    if (Test-Path $stdoutFile) {
        $stdout = Get-Content $stdoutFile -Raw -ErrorAction SilentlyContinue
        Remove-Item $stdoutFile -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path $stderrFile) {
        $stderr = Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue
        Remove-Item $stderrFile -Force -ErrorAction SilentlyContinue
    }

    if ($stdout -and $stdout.Trim()) {
        Add-Content -Path $StartupLog -Value $stdout.TrimEnd()
    }

    if ($stderr -and $stderr.Trim()) {
        Add-Content -Path $StartupLog -Value $stderr.TrimEnd()
    }

    $combined = ""
    if ($stdout) { $combined += $stdout }
    if ($stderr) {
        if ($combined) { $combined += "`n" }
        $combined += $stderr
    }

    return @{
        ExitCode = $proc.ExitCode
        StdOut = $stdout
        StdErr = $stderr
        Combined = $combined.Trim()
    }
}

function Get-ModelEntriesFromJson {
    param([string]$JsonText)

    if (-not $JsonText -or -not $JsonText.Trim()) {
        return @()
    }

    try {
        $parsed = $JsonText | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $parsed) { return @() }
        if ($parsed -is [System.Array]) { return @($parsed) }
        if ($parsed.data) { return @($parsed.data) }
        return @($parsed)
    } catch {
        Write-LauncherLog "Failed to parse JSON output: $($_.Exception.Message)" "WARN"
        return @()
    }
}

function Test-DesiredModelLoaded {
    param([string]$LmsPath)

    $ps = Invoke-Lms -LmsPath $LmsPath -Arguments @("ps", "--json") -Label "lms_ps_check"
    $entries = Get-ModelEntriesFromJson -JsonText $ps.Combined

    foreach ($entry in $entries) {
        $entryJson = $entry | ConvertTo-Json -Depth 20
        if ($entryJson -match [regex]::Escape($ModelName) -and $entryJson -match "\b$ContextLength\b") {
            return $true
        }
    }

    return $false
}

function Ensure-LmStudioServerAndModel {
    $lms = Get-LmsPath
    if (-not $lms) {
        throw "LM Studio CLI 'lms' was not found in PATH."
    }

    Write-LauncherLog "Resolved lms path: $lms"

    $start = Invoke-Lms -LmsPath $lms -Arguments @("server", "start") -Label "lms_server_start"
    Write-LauncherLog "lms server start exit code: $($start.ExitCode)"

    $status = Invoke-Lms -LmsPath $lms -Arguments @("server", "status") -Label "lms_server_status"
    Write-LauncherLog "lms server status exit code: $($status.ExitCode)"

    if ($status.Combined -notmatch '(?i)running|started|listening|online') {
        throw "LM Studio server status did not indicate a running server."
    }

    if (Test-DesiredModelLoaded -LmsPath $lms) {
        Write-LauncherLog "Desired model already loaded with context $ContextLength"
        return
    }

    $unload = Invoke-Lms -LmsPath $lms -Arguments @("unload", "--all") -Label "lms_unload_all"
    Write-LauncherLog "lms unload --all exit code: $($unload.ExitCode)"

    $load = Invoke-Lms -LmsPath $lms -Arguments @("load", $ModelName, "--context-length", "$ContextLength") -Label "lms_load"
    Write-LauncherLog "lms load exit code: $($load.ExitCode)"

    if (-not (Test-DesiredModelLoaded -LmsPath $lms)) {
        throw "Model '$ModelName' with context $ContextLength was not confirmed by 'lms ps --json'."
    }

    Write-LauncherLog "Confirmed LM Studio server and model"
}

function Stop-OldBackend {
    if (Test-Path $BackendPidFile) {
        try {
            $savedProcId = [int](Get-Content $BackendPidFile | Select-Object -First 1)
            if ($savedProcId) {
                $proc = Get-Process -Id $savedProcId -ErrorAction SilentlyContinue
                if ($proc) {
                    Stop-Process -Id $savedProcId -Force -ErrorAction SilentlyContinue
                    Write-LauncherLog "Stopped previous backend from pid file (PID $savedProcId)"
                    Start-Sleep -Milliseconds 300
                }
            }
        } catch {
            Write-LauncherLog "Could not use existing backend pid file: $($_.Exception.Message)" "WARN"
        }
        Remove-Item $BackendPidFile -Force -ErrorAction SilentlyContinue
    }

    Stop-ProcessesOnPort -Port 3000
}

function Start-Backend {
    Stop-OldBackend

    Write-LauncherLog "Starting Node backend hidden"
    $proc = Start-Process -FilePath "node" `
        -ArgumentList @("server.js") `
        -WorkingDirectory $ProjectDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $BackendOut `
        -RedirectStandardError $BackendErr `
        -PassThru

    Set-Content -Path $BackendPidFile -Value $proc.Id
    Write-LauncherLog "Backend started (PID $($proc.Id))"

    if (-not (Wait-HttpUp -Url $BackendHealthUrl -Retries 120 -DelayMs 1000)) {
        throw "Backend did not come online on :3000"
    }

    Write-LauncherLog "Backend HTTP online"
    return $proc.Id
}

try {
    Write-LauncherLog "==== LAUNCH BEGIN ===="
    Ensure-LmStudioServerAndModel
    $backendPid = Start-Backend
    Save-LauncherState @{
        startedAt = (Get-Date).ToString("o")
        backendPid = $backendPid
        model = $ModelName
        contextLength = $ContextLength
        backendUrl = "http://localhost:3000"
        launcherMode = "CLI status + ps verification + smart reload"
    }
    Write-LauncherLog "Opening WebUI"
    Start-Process "http://localhost:3000"
    Write-LauncherLog "==== LAUNCH COMPLETE ===="
} catch {
    Write-LauncherError $_.Exception.Message
    Write-LauncherError $_.ScriptStackTrace
    Write-LauncherLog $_.Exception.Message "ERROR"
    Write-LauncherLog $_.ScriptStackTrace "ERROR"
}
