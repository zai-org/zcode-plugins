# 小栖桌宠事件投递（Windows 兜底，兼容 Windows PowerShell 5.1）。
# 当机器上没有 bash 时由 hooks.json 的 `||` 分支调用；行为与 feed-event.sh 一致：
# 把 stdin JSON 包装成一个事件文件写到 %APPDATA%\XiaoqiPet\feed\，先写临时文件再改名，永远退出 0。

param([string]$Event = "")

$ErrorActionPreference = "SilentlyContinue"
$allowed = @("SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "Stop")
if ($allowed -notcontains $Event) { exit 0 }

$appdata = $env:APPDATA
if (-not $appdata) { $appdata = Join-Path $env:USERPROFILE "AppData\Roaming" }
$dir = Join-Path (Join-Path $appdata "XiaoqiPet") "feed"
try {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
} catch {
  exit 0
}

$payload = ""
try { $payload = [Console]::In.ReadToEnd() } catch { $payload = "" }
if ($payload.Length -gt 65536) { $payload = $payload.Substring(0, 65536) }

$cwd = (Get-Location).Path.Replace("\", "\\").Replace('"', '\"')
$at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$json = '{"v":1,"event":"' + $Event + '","at":' + $at + ',"cwd":"' + $cwd + '","payload":' + $payload + '}'

$tmp = Join-Path $dir (".feed." + [guid]::NewGuid().ToString("N"))
$final = Join-Path $dir ("{0}-{1}-{2}.json" -f $at, $PID, (Get-Random -Maximum 32767))
try {
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -Force -Path $tmp -Destination $final
} catch {
  Remove-Item -Force -Path $tmp
}

# 桌宠应用不在线时避免目录无限增长：每小时顺带清理超过一天的残留事件文件。
$marker = Join-Path $dir ".cleaned"
$stale = $true
if (Test-Path $marker) {
  $stale = ((Get-Date) - (Get-Item $marker).LastWriteTime).TotalSeconds -gt 3600
}
if ($stale) {
  Get-ChildItem -Path $dir -Filter *.json | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force
  New-Item -ItemType File -Force -Path $marker | Out-Null
}

exit 0
