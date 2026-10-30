# Cot Peek installer.
# Registers a per-user scheduled task: every minute it starts the floating
# ball when ZCode is running, so the ball follows ZCode's lifetime.
# Usage:   pwsh install.ps1          to install
#          pwsh install.ps1 -Remove  to uninstall
param([switch]$Remove)

$ErrorActionPreference = "Stop"
$taskName = "ZCodeCotPeek"
$root = $PSScriptRoot

if ($Remove) {
    schtasks.exe /Delete /TN $taskName /F 2>$null
    Write-Host "Scheduled task '$taskName' removed."
    exit 0
}

# Locate pythonw.exe: PATH first, then common install locations.
$exe = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $exe) {
    $patterns = @(
        "$env:LOCALAPPDATA\Programs\Python\*\pythonw.exe",
        "C:\Python*\pythonw.exe",
        "$env:USERPROFILE\miniconda3\envs\*\pythonw.exe",
        "$env:USERPROFILE\anaconda3\envs\*\pythonw.exe",
        "C:\ProgramData\miniconda3\envs\*\pythonw.exe",
        "C:\ProgramData\anaconda3\envs\*\pythonw.exe"
    )
    $exe = (Get-Item $patterns -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1).FullName
}
if (-not $exe) {
    Write-Error "pythonw.exe not found. Install Python 3 with tkinter, then re-run."
    exit 1
}

$tr = "`"$exe`" `"$root\cot_peek.py`" --autospawn"
schtasks.exe /Create /TN $taskName /SC MINUTE /MO 1 /TR $tr /F
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done. The floating ball appears within a minute whenever ZCode runs."
    Write-Host "Start it right now:  double-click start-cot-peek.bat"
    Write-Host "Uninstall:           pwsh install.ps1 -Remove"
} else {
    Write-Warning "schtasks failed. Start manually with start-cot-peek.bat."
}
