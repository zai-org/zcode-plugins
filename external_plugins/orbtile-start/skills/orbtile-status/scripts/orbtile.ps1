# Orbtile starter script for Windows shells without sh (Codex runs hooks with cmd.exe on Windows).
# Source of truth: shared/orbtile.ps1. The Codex plugin carries an identical copy (tests check this).
# Same behaviour and wording as shared/orbtile.sh for Codex, Antigravity and ZCode on Windows.
#
#   orbtile.ps1 <agent> session-start   Session-start hook: at most one line a day pointing to the Orbtile app,
#                                       nothing once the Orbtile app is installed or its hooks are set up.
#   orbtile.ps1 <agent> status          Plain-text setup check.
#   <agent>: codex | antigravity | zcode (all followed by the app without hooks)
#
# Reads local files only. Sends nothing anywhere. Always exits 0 so it can never block a session.

param([string]$Agent = '', [string]$Command = '')
$ErrorActionPreference = 'SilentlyContinue'
$downloadUrl = 'https://orbtile.com/download'

if (($Agent -ne 'codex' -and $Agent -ne 'antigravity' -and $Agent -ne 'zcode') -or ($Command -ne 'session-start' -and $Command -ne 'status')) {
    [Console]::Error.WriteLine('usage: orbtile.ps1 codex|antigravity|zcode session-start|status')
    exit 0
}

if ($Agent -eq 'codex') {
    $agentName = 'Codex'
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $configFile = Join-Path $codexHome 'hooks.json'
    $pitch = 'Orbtile shows your Codex sessions live on a keypad'
    $checkHint = 'ask Codex to check your Orbtile setup'
    $doneLine = 'Next step: none. Orbtile is set up; this starter plugin stays quiet and can be removed with: codex plugin remove orbtile-start@orbtile-public'
    $hooksOptional = 'Orbtile reads Codex sessions without them'
} elseif ($Agent -eq 'zcode') {
    $agentName = 'ZCode'
    $configFile = Join-Path $env:USERPROFILE '.zcode\cli\config.json'
    $pitch = 'Orbtile shows your ZCode tasks live on a keypad'
    $checkHint = 'ask ZCode to check your Orbtile setup'
    $doneLine = 'Next step: none. Orbtile is set up. You can remove the orbtile-start plugin from ZCode.'
    $hooksOptional = 'Orbtile follows ZCode tasks from their files without them'
} else {
    $agentName = 'Antigravity'
    $configFile = Join-Path $env:USERPROFILE '.gemini\config\hooks.json'
    $pitch = 'Orbtile shows your Antigravity sessions live on a keypad'
    $checkHint = 'ask Antigravity to check your Orbtile setup'
    $doneLine = 'Next step: none. Orbtile is set up. You can remove the orbtile-start plugin from Antigravity.'
    $hooksOptional = 'Orbtile reads Antigravity sessions without them'
}

# Orbtile's hooks for this agent: the Windows app's helper (--orbtile-agent), or the Mac app's script name.
function Get-HookMarker {
    if (-not (Test-Path -LiteralPath $configFile)) { return '' }
    $text = Get-Content -LiteralPath $configFile -Raw
    if ($text -and $text -match "orbtile(-[a-z]+)?-$Agent-hook|--orbtile-agent") { return 'Orbtile hooks' }
    return ''
}

# The Windows app keeps its data in %LOCALAPPDATA%\Orbtile.
function Get-AppPath {
    if (-not $env:LOCALAPPDATA) { return '' }
    $p = Join-Path $env:LOCALAPPDATA 'Orbtile'
    if (Test-Path -LiteralPath $p -PathType Container) { return $p }
    return ''
}

if ($Command -eq 'session-start') {
    # Orbtile follows Codex and Antigravity without hooks: an installed app is a set-up app.
    if ((Get-HookMarker) -or (Get-AppPath)) { exit 0 }
    # Once a day at most. Without a writable state folder it still shows (the hook runs once per new session).
    $today = [string][math]::Floor([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() / 86400)
    if ($env:PLUGIN_DATA) {
        $stateFile = Join-Path $env:PLUGIN_DATA 'last-shown-day'
        $last = Get-Content -LiteralPath $stateFile -TotalCount 1
        if ($last -eq $today) { exit 0 }
        New-Item -ItemType Directory -Force -Path $env:PLUGIN_DATA | Out-Null
        Set-Content -LiteralPath $stateFile -Value $today -Encoding ascii
    }
    $msg = "${pitch}: $downloadUrl ($checkHint)"
    [Console]::Out.WriteLine('{"systemMessage":"' + $msg + '"}')
    exit 0
}

# status
$marker = Get-HookMarker
$app = Get-AppPath
[Console]::Out.WriteLine("Orbtile setup check for $agentName")
if ($app) { [Console]::Out.WriteLine("- Orbtile app: found at $app") } else { [Console]::Out.WriteLine('- Orbtile app: not found on this computer') }
if ($marker) { [Console]::Out.WriteLine("- Orbtile's $agentName hooks: on ($marker in $configFile)") }
else { [Console]::Out.WriteLine("- Orbtile's $agentName hooks: off (optional: $hooksOptional)") }
if ($marker -or $app) {
    if ($marker -and $Agent -eq 'codex') { [Console]::Out.WriteLine("- Note: Codex runs Orbtile's hooks only after you trust them once in /hooks (Settings > Hooks in the Codex app).") }
    [Console]::Out.WriteLine($doneLine)
} else {
    [Console]::Out.WriteLine("Next step: download Orbtile from $downloadUrl")
}
exit 0
