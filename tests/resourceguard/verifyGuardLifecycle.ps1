[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$fixturePath = Join-Path $taskRoot 'resourceGuardFixture.cjs'
$launcherPath = Join-Path $taskRoot 'runGuardedTest.ps1'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$pwshPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
$evidenceRoot = Join-Path $taskRoot 'guard-verification'
[System.IO.Directory]::CreateDirectory($evidenceRoot) | Out-Null
$startedSupervisors = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$observedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$checks = [System.Collections.Generic.List[object]]::new()
$originalMode = [Environment]::GetEnvironmentVariable('AIONUI_RESOURCE_FIXTURE_MODE', 'Process')

function Start-FixtureGuard([string]$label, [string]$mode, [int]$seconds, [string]$testFile = $fixturePath) {
    $reportFile = Join-Path $evidenceRoot ($label + '.json')
    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', ('"' + $launcherPath + '"'),
        '-NodePath', ('"' + $nodePath + '"'), '-TestPath', ('"' + $testFile + '"'),
        '-MemoryLimitMiB', '256', '-TimeoutSeconds', [string]$seconds,
        '-ReportPath', ('"' + $reportFile + '"')
    )
    $previousMode = [Environment]::GetEnvironmentVariable('AIONUI_RESOURCE_FIXTURE_MODE', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('AIONUI_RESOURCE_FIXTURE_MODE', $mode, 'Process')
        $supervisor = Start-Process -FilePath $pwshPath -ArgumentList $arguments -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $evidenceRoot ($label + '.log')) `
            -RedirectStandardError (Join-Path $evidenceRoot ($label + '.stderr.log'))
        # Retain a real process handle, so later checks cannot accidentally target a recycled PID.
        $null = $supervisor.Handle
        $startedSupervisors.Add($supervisor)
        return [PSCustomObject]@{ Process=$supervisor; ReportFile=$reportFile }
    } finally {
        [Environment]::SetEnvironmentVariable('AIONUI_RESOURCE_FIXTURE_MODE', $previousMode, 'Process')
    }
}

function Capture-FixtureProcess($record) {
    $process = [System.Diagnostics.Process]::GetProcessById([int]$record.ProcessId)
    $null = $process.Handle
    if ($process.HasExited -or $process.ProcessName -ne 'node') { throw 'Fixture process exited before capture' }
    $observedProcesses.Add($process)
    return $process
}

function Wait-FixturePair([System.Diagnostics.Process]$supervisor) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt 6000) {
        if ($supervisor.HasExited) { throw 'Supervisor exited before bounded fixture started' }
        $roots = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = {0} AND Name = 'node.exe'" -f $supervisor.Id) |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fixturePath) })
        if ($roots.Count -eq 1) {
            $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = {0} AND Name = 'node.exe'" -f $roots[0].ProcessId) |
                Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fixturePath) -and $_.CommandLine.Contains('--guard-fixture-child') })
            if ($children.Count -eq 1) {
                return [PSCustomObject]@{Root=(Capture-FixtureProcess $roots[0]); Child=(Capture-FixtureProcess $children[0])}
            }
        }
        Start-Sleep -Milliseconds 50
    }
    throw 'Bounded fixture parent/child did not become observable in time'
}

function Wait-Supervisor($run, [int]$milliseconds = 12000) {
    if (-not $run.Process.WaitForExit($milliseconds)) { throw 'Guard verification exceeded its own bounded wait' }
    $run.Process.Refresh()
    if (-not (Test-Path -LiteralPath $run.ReportFile)) { throw 'Guard report is missing' }
    return Get-Content -LiteralPath $run.ReportFile -Raw | ConvertFrom-Json
}

try {
    # One timeout fixture holds the mutex. The second must refuse without starting Node.
    $first = Start-FixtureGuard 'lifecycle-first' 'timeout' 8
    $firstPair = Wait-FixturePair $first.Process
    $second = Start-FixtureGuard 'lifecycle-concurrent' 'pass' 3
    $secondReport = Wait-Supervisor $second 7000
    if ($secondReport.Reason -ne 'another_guarded_test_running' -or $secondReport.ExitCode -ne 125 -or
        $secondReport.ProtectedBeforeStart -or $secondReport.ProcessId -ne 0) {
        throw 'Concurrent guarded suite was not refused before test startup'
    }
    $firstReport = Wait-Supervisor $first 12000
    if ($firstReport.Reason -ne 'timeout' -or $firstReport.ExitCode -ne 124 -or $firstReport.ActiveProcessesAfterCleanup -ne 0) {
        throw 'First bounded fixture did not time out and clean up normally'
    }
    $firstRootGone = $firstPair.Root.WaitForExit(3000)
    $firstChildGone = $firstPair.Child.WaitForExit(3000)
    if (-not ($firstRootGone -and $firstChildGone)) { throw 'Timeout left an observed fixture process alive' }
    $checks.Add([PSCustomObject]@{Name='concurrent-suite-rejected';Passed=$true;FirstExitCode=$firstReport.ExitCode;SecondExitCode=$secondReport.ExitCode;SecondReason=$secondReport.Reason;RootGone=$firstRootGone;ChildGone=$firstChildGone})

    # Kill only the explicitly spawned supervisor whose handle is retained above.
    # Its Job Object must close automatically and kill both observed Node processes.
    $abrupt = Start-FixtureGuard 'lifecycle-supervisor-killed' 'timeout' 8
    $abruptPair = Wait-FixturePair $abrupt.Process
    $abrupt.Process.Kill($false)
    if (-not $abrupt.Process.WaitForExit(3000)) { throw 'Dedicated test supervisor did not stop' }
    $abruptRootGone = $abruptPair.Root.WaitForExit(5000)
    $abruptChildGone = $abruptPair.Child.WaitForExit(5000)
    if (-not ($abruptRootGone -and $abruptChildGone)) { throw 'KILL_ON_JOB_CLOSE left an observed fixture process alive' }
    $checks.Add([PSCustomObject]@{Name='supervisor-death-kills-job';Passed=$true;SupervisorId=$abrupt.Process.Id;RootId=$abruptPair.Root.Id;ChildId=$abruptPair.Child.Id;RootGone=$abruptRootGone;ChildGone=$abruptChildGone})

    # A bad target must fail closed before any test process is created.
    $missingPath = Join-Path $taskRoot 'deliberately-missing-resourceGuardFixture.cjs'
    if (Test-Path -LiteralPath $missingPath) { throw 'Expected synthetic missing path unexpectedly exists' }
    $missing = Start-FixtureGuard 'lifecycle-invalid-target' 'pass' 3 $missingPath
    $missingReport = Wait-Supervisor $missing 7000
    if ($missingReport.ExitCode -ne 125 -or $missingReport.ProtectedBeforeStart -or $missingReport.ProcessId -ne 0) {
        throw 'Invalid test target did not fail closed'
    }
    $checks.Add([PSCustomObject]@{Name='invalid-target-refused';Passed=$true;Reason=$missingReport.Reason;ExitCode=$missingReport.ExitCode;ProcessId=$missingReport.ProcessId})

    $result = [PSCustomObject]@{Passed=$true;Checks=@($checks.ToArray())}
    $json = $result | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText((Join-Path $evidenceRoot 'lifecycle-verification.json'), $json + [Environment]::NewLine)
    Write-Output $json
} finally {
    [Environment]::SetEnvironmentVariable('AIONUI_RESOURCE_FIXTURE_MODE', $originalMode, 'Process')
    foreach ($supervisor in $startedSupervisors) {
        try { if (-not $supervisor.HasExited) { $supervisor.Kill($false); $null = $supervisor.WaitForExit(3000) } } finally { $supervisor.Dispose() }
    }
    foreach ($process in $observedProcesses) { $process.Dispose() }
}
