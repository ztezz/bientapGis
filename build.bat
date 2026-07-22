@echo off
setlocal
pushd "%~dp0"

title VN-LandEditor Build
echo ========================================
echo   VN-LandEditor - Windows Build
echo ========================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 18 or newer, then run this file again.
  goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found.
  goto :failed
)

if not exist "node_modules\" (
  echo [1/3] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :failed
) else (
  echo [1/3] Dependencies are available.
)

echo [2/3] Building renderer...
call npm.cmd run build:renderer
if errorlevel 1 goto :failed

if /I "%~1"=="installer" goto :installer

echo [3/3] Building portable application...
call npx.cmd electron-builder --dir --config.win.signAndEditExecutable=false
if errorlevel 1 goto :failed
set "OUTPUT=dist-electron\win-unpacked\VN-LandEditor.exe"
goto :success

:installer
echo [3/3] Building NSIS installer...
call npx.cmd electron-builder --win nsis
if errorlevel 1 goto :failed
set "OUTPUT=dist-electron"
goto :success

:success
echo.
echo ========================================
echo   BUILD COMPLETED
echo ========================================
echo Output: %OUTPUT%
echo.
popd
pause
exit /b 0

:failed
echo.
echo ========================================
echo   BUILD FAILED
echo ========================================
echo Review the error messages above.
echo Close VN-LandEditor if files in dist-electron are locked.
echo.
popd
pause
exit /b 1
