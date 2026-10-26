[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$TestPath,
    [string]$NodePath = (Get-Command node.exe -ErrorAction Stop).Source,
    [ValidateRange(128,2048)][int]$MemoryLimitMiB = 1536,
    [ValidateRange(1,1800)][int]$TimeoutSeconds = 120,
    [switch]$LongRunningSuite,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
try {
    if (-not $IsWindows) { throw 'Windows Job Objects are required. No test was started.' }
    if (-not ('AionUi.TestProcessGuard' -as [type])) {
        Add-Type -LiteralPath (Join-Path $PSScriptRoot 'TestProcessGuard.cs') -ErrorAction Stop
    }
    $guardResult = [AionUi.TestProcessGuard]::Run($NodePath, $TestPath, $MemoryLimitMiB, $TimeoutSeconds, $LongRunningSuite.IsPresent)
    # A bounded tail is printed only after the child process tree has stopped.
    if ($guardResult.OutputTail) { [Console]::Out.Write($guardResult.OutputTail) }
    $guardReport = $guardResult | Select-Object * -ExcludeProperty OutputTail
    $guardJson = $guardReport | ConvertTo-Json -Compress
    if ($ReportPath) {
        [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($ReportPath), $guardJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    }
    [Console]::Out.WriteLine()
    [Console]::Out.WriteLine('AIONUI_TEST_GUARD ' + $guardJson)
    exit $guardResult.ExitCode
} catch {
    $guardJson = @{Reason='supervisor_setup_failed';ExitCode=125;Error=$_.Exception.Message;ProtectedBeforeStart=$false} | ConvertTo-Json -Compress
    [Console]::Error.WriteLine('AIONUI_TEST_GUARD ' + $guardJson)
    exit 125
}
