@echo off
setlocal
cd /d "%~dp0"

echo Installing frontend dependencies...
call npm.cmd --prefix frontend install
if errorlevel 1 exit /b %errorlevel%

echo Building React frontend...
call npm.cmd --prefix frontend run build
if errorlevel 1 exit /b %errorlevel%

echo.
echo Build complete. Run with:
echo   run.cmd
echo Or directly:
echo   python -m backend --host 127.0.0.1 --port 8000
