param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8000,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Get-PythonCommand {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand -and $pythonCommand.Source -notlike "*WindowsApps*") {
    return [pscustomobject]@{
      Path = $pythonCommand.Source
      PreArgs = @()
    }
  }
  $pyCommand = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCommand) {
    return [pscustomobject]@{
      Path = $pyCommand.Source
      PreArgs = @("-3")
    }
  }
  throw "Python was not found. Install Python 3.11+ from https://www.python.org/downloads/ and enable Add python.exe to PATH."
}

$python = Get-PythonCommand
$arguments = @("-m", "backend", "--host", $BindHost, "--port", "$Port")
if ($NoBrowser) {
  $arguments += "--no-browser"
}

Write-Host "Starting GOVis at http://$BindHost`:$Port/"
$pythonExe = $python.Path
$pythonArgs = @($python.PreArgs)
$pythonArgs += $arguments
& $pythonExe @pythonArgs
