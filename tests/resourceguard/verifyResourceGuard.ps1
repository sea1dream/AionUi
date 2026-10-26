[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$guardPwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$guardLauncher = Join-Path $PSScriptRoot 'runGuardedTest.ps1'
$guardFixture = Join-Path $PSScriptRoot 'resourceGuardFixture.cjs'
$guardEvidence = Join-Path $PSScriptRoot 'guard-verification'
[void][System.IO.Directory]::CreateDirectory($guardEvidence)
$guardResults = [System.Collections.Generic.List[object]]::new()
$previousMode = $env:AIONUI_RESOURCE_FIXTURE_MODE

function Assert-GuardProcessesGone([string]$LogText) {
    foreach ($match in [regex]::Matches($LogText, 'fixture-child-(?:spawned|ready) pid=(\d+)')) {
        $fixturePid = [int]$match.Groups[1].Value
        if (Get-Process -Id $fixturePid -ErrorAction SilentlyContinue) {
            throw "Fixture descendant still running: $fixturePid"
        }
    }
}

function Invoke-GuardProbe([string]$Mode, [int]$Memory, [int]$Seconds, [int]$ExpectedExit, [string]$ExpectedReason, [switch]$LongRunningSuite, [string]$Label = $Mode) {
    $env:AIONUI_RESOURCE_FIXTURE_MODE = $Mode
    $probeLog = Join-Path $guardEvidence ($Label + '.log')
    $probeReport = Join-Path $guardEvidence ($Label + '.json')
    & $guardPwsh -NoLogo -NoProfile -NonInteractive -File $guardLauncher -TestPath $guardFixture -MemoryLimitMiB $Memory -TimeoutSeconds $Seconds -LongRunningSuite:$($LongRunningSuite.IsPresent) -ReportPath $probeReport *> $probeLog
    $probeExit = $LASTEXITCODE
    if ($probeExit -ne $ExpectedExit) { throw "$Mode exit $probeExit; expected $ExpectedExit. See $probeLog" }
    $probe = Get-Content -LiteralPath $probeReport -Raw | ConvertFrom-Json
    if ($probe.Reason -ne $ExpectedReason) { throw "$Mode reason $($probe.Reason); expected $ExpectedReason" }
    if (-not $probe.ProtectedBeforeStart -or $probe.ActiveProcessesAfterCleanup -ne 0) { throw "$Mode did not establish and clean up job protection" }
    if ($probe.PeakJobMemoryBytes -gt $Memory * 1MB) { throw "$Mode exceeded the kernel commit limit" }
    $probeText = Get-Content -LiteralPath $probeLog -Raw
    Assert-GuardProcessesGone $probeText
    if ((Get-Item -LiteralPath $probeLog).Length -gt 200KB) { throw "$Mode supervisor output was not bounded" }
    $entry = [pscustomobject]@{Case=$Label;Passed=$true;ExitCode=$probeExit;Reason=$probe.Reason;PeakMiB=[math]::Round($probe.PeakJobMemoryBytes/1MB,1);ElapsedMs=$probe.ElapsedMilliseconds;ActiveAfter=$probe.ActiveProcessesAfterCleanup}
    $guardResults.Add($entry)
    $entry | ConvertTo-Json -Compress
}

try {
    Invoke-GuardProbe 'pass' 256 5 0 'completed'
    Invoke-GuardProbe 'fail' 256 5 1 'test_failed'
    Invoke-GuardProbe 'timeout' 256 2 124 'timeout'
    Invoke-GuardProbe 'descendant' 256 5 0 'completed'
    # The fixture allocates at most 192 MiB, even if the guard were broken.
    Invoke-GuardProbe 'memory' 128 5 125 'memory_limit'
    # The fixture writes at most 5 MiB; supervisor retains at most 64 KiB.
    Invoke-GuardProbe 'output' 256 5 126 'output_limit'
    # Long budgets require an explicit opt-in and keep the same memory cap.
    $longRejectedReport = Join-Path $guardEvidence 'long-suite-without-opt-in.json'
    $env:AIONUI_RESOURCE_FIXTURE_MODE = 'pass'
    & $guardPwsh -NoLogo -NoProfile -NonInteractive -File $guardLauncher -TestPath $guardFixture -MemoryLimitMiB 256 -TimeoutSeconds 301 -ReportPath $longRejectedReport *> (Join-Path $guardEvidence 'long-suite-without-opt-in.log')
    if ($LASTEXITCODE -ne 125) { throw 'Long budget without opt-in was not rejected' }
    $longRejected = Get-Content -LiteralPath $longRejectedReport -Raw | ConvertFrom-Json
    if ($longRejected.ProtectedBeforeStart -or $longRejected.ProcessId -ne 0 -or $longRejected.Reason -ne 'validation_failed') { throw 'Long budget was not rejected before starting Node' }
    $guardResults.Add([pscustomobject]@{Case='long-suite-without-opt-in';Passed=$true;ExitCode=125;Reason=$longRejected.Reason;ProcessId=0})
    Invoke-GuardProbe 'pass' 256 1800 0 'completed' -LongRunningSuite -Label 'long-suite-opt-in'
    $guardResults | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $guardEvidence 'bounded-fixtures.json') -Encoding utf8
} finally {
    $env:AIONUI_RESOURCE_FIXTURE_MODE = $previousMode
}
