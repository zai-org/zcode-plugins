@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "LOCAL_PS1=%SCRIPT_DIR%install-libtv-cli.ps1"

if not exist "%LOCAL_PS1%" goto download_remote

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_PS1%" %*
exit /b %ERRORLEVEL%

:download_remote

set "LIBTV_VERSION_CHANNEL_ID=240"
if not "%LIBTV_CLI_VERSION_CHANNEL_ID%"=="" set "LIBTV_VERSION_CHANNEL_ID=%LIBTV_CLI_VERSION_CHANNEL_ID%"
set "REMOTE_CONFIG_URL=https://api2.liblib.art/api/www/landing-activities/getById?id=%LIBTV_VERSION_CHANNEL_ID%"
set "TEMP_PS1=%TEMP%\install-libtv-cli-%RANDOM%%RANDOM%.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $resp = Invoke-RestMethod -Uri $env:REMOTE_CONFIG_URL -UseBasicParsing; $link = if ($resp -and $resp.data -and $resp.data.linkUrl) { [string]$resp.data.linkUrl } else { '' }; $config = if ($link) { ConvertFrom-Json $link } else { $null }; $remotePs1 = if ($config -and $config.install -and $config.install.PowerShell) { [string]$config.install.PowerShell } else { '' }; if (-not $remotePs1) { throw ('missing install.PowerShell in ' + $env:REMOTE_CONFIG_URL) }; Invoke-WebRequest -Uri $remotePs1 -UseBasicParsing -OutFile $env:TEMP_PS1; $text = [IO.File]::ReadAllText($env:TEMP_PS1, [Text.Encoding]::UTF8); [IO.File]::WriteAllText($env:TEMP_PS1, $text, [Text.Encoding]::UTF8) } catch { Write-Error $_; exit 1 }"
if errorlevel 1 exit /b %ERRORLEVEL%

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS1%" %*
set "EXIT_CODE=%ERRORLEVEL%"
del "%TEMP_PS1%" >nul 2>nul
exit /b %EXIT_CODE%
