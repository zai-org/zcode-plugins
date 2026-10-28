# One-time credential setup for the cloudflare-clef plugin.
# Stores the Cloudflare Account ID and API token DPAPI-encrypted (bound to the current
# Windows user) at %USERPROFILE%\.zcode\secrets\cloudflare-clef.json.
# Re-run to rotate credentials; delete that file to revoke them.
# Interactive by default; -AccountId/-Token parameters enable non-interactive automation.
param(
  [string]$AccountId,
  [string]$Token
)
$ErrorActionPreference = "Stop"

$secretPath = Join-Path $env:USERPROFILE ".zcode\secrets\cloudflare-clef.json"

if (-not $AccountId) { $AccountId = Read-Host "Cloudflare Account ID (32 hex characters)" }
if (-not $Token) {
  $tokenSecure = Read-Host "Cloudflare API Token (input hidden)" -AsSecureString
} else {
  $tokenSecure = ConvertTo-SecureString $Token -AsPlainText -Force
}

if ($AccountId -notmatch '^[a-fA-F0-9]{32}$') { throw "Account ID must be exactly 32 hex characters (got: $AccountId)." }
if ($tokenSecure.Length -eq 0) { throw "API token must not be empty." }

$encAccount = ConvertFrom-SecureString (ConvertTo-SecureString $AccountId -AsPlainText -Force)
$encToken = ConvertFrom-SecureString $tokenSecure

$dir = Split-Path -Parent $secretPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
@{ accountId = $encAccount; apiToken = $encToken } |
  ConvertTo-Json -Compress |
  Set-Content -LiteralPath $secretPath -Encoding ASCII

# Round-trip check: the same Windows user must be able to decrypt what was just written.
$check = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
ConvertTo-SecureString -String $check.apiToken | Out-Null
ConvertTo-SecureString -String $check.accountId | Out-Null

Write-Host "Stored DPAPI-encrypted credentials at $secretPath"
Write-Host "(Bound to this Windows user; the file is useless if copied to another machine or user account.)"
Write-Host "Restart ZCode so the plugin's MCP server picks them up."
