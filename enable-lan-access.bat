@echo off
title iPerf3 Hub - Enable LAN Access
cd /d "%~dp0"

:: Check for Administrator permissions
net session >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo [OK] Running with Administrator privileges.
) else (
    echo [!] Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-lan-access.ps1"

echo.
echo Press any key to exit...
pause >nul
