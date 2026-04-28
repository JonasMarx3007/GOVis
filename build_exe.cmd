@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="
set "PYTHON_PREARGS="

for /f "delims=" %%I in ('where python 2^>nul') do (
  echo %%~fI | find /i "WindowsApps" >nul
  if errorlevel 1 (
    set "PYTHON_EXE=%%~fI"
    goto :python_found
  )
)

for /f "delims=" %%I in ('where py 2^>nul') do (
  set "PYTHON_EXE=%%~fI"
  set "PYTHON_PREARGS=-3"
  goto :python_found
)

:python_found
if not defined PYTHON_EXE (
  echo Python was not found.
  echo Install Python 3.11+ from https://www.python.org/downloads/ and enable "Add python.exe to PATH".
  exit /b 1
)

call build.cmd
if errorlevel 1 exit /b %errorlevel%

if defined PYTHON_PREARGS (
  "%PYTHON_EXE%" %PYTHON_PREARGS% -m PyInstaller --version >nul 2>nul
) else (
  "%PYTHON_EXE%" -m PyInstaller --version >nul 2>nul
)
if errorlevel 1 (
  echo PyInstaller is missing. Install it with:
  if defined PYTHON_PREARGS (
    echo   "%PYTHON_EXE%" %PYTHON_PREARGS% -m pip install pyinstaller
  ) else (
    echo   "%PYTHON_EXE%" -m pip install pyinstaller
  )
  exit /b 1
)

echo Building standalone GOVis.exe...
if defined PYTHON_PREARGS (
  "%PYTHON_EXE%" %PYTHON_PREARGS% -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --onefile ^
    --name GOVis ^
    --add-data "go-basic.obo;." ^
    --add-data "annotations;annotations" ^
    --add-data "frontend\dist;frontend\dist" ^
    backend\__main__.py
) else (
  "%PYTHON_EXE%" -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --onefile ^
    --name GOVis ^
    --add-data "go-basic.obo;." ^
    --add-data "annotations;annotations" ^
    --add-data "frontend\dist;frontend\dist" ^
    backend\__main__.py
)
if errorlevel 1 exit /b %errorlevel%

echo.
echo Standalone executable built:
echo   dist\GOVis.exe
