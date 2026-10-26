# Windows test resource guard

Use this optional guard for standalone CommonJS `node:test` suites that parse large bundles or render React fixtures. It bounds the **combined committed memory of the test process and all descendants**, including native memory outside the JavaScript heap. It does not change AionUi runtime behavior or access application data.

Requirements: Windows, PowerShell 7 (`pwsh.exe` on `PATH`), and Node.js with `--test-isolation=none` support. The guard was verified with Node.js 24.

## Run a protected test

From the repository root:

```powershell
pwsh -NoProfile -File tests/resourceguard/runGuardedTest.ps1 -TestPath path/to/example.test.cjs
```

To make a standalone test protect itself even when invoked with `node --test`, call the bootstrap **before loading React, jsdom, TypeScript, or other heavy dependencies**:

```javascript
require('./relative/path/to/tests/resourceguard/testSafety.cjs').ensureGuarded(__filename);
```

The included synthetic fixture uses this bootstrap:

```powershell
node --test tests/resourceguard/resourceGuardFixture.cjs
```

The bootstrap restarts the test through the external supervisor. It never falls back to an unprotected run when PowerShell, compilation, or Job Object setup fails. `AIONUI_TEST_RESOURCE_GUARDED` and `AIONUI_TEST_RESOURCE_GUARD_PATH` are internal hand-off variables; do not set them manually.

## Limits and failure behavior

| Limit                         | Default behavior                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Combined committed memory     | 1536 MiB kernel hard limit; terminate at approximately 90% as an earlier safeguard         |
| Node old-generation heap      | 512 MiB                                                                                    |
| Wall-clock runtime            | Terminate the process tree after 120 seconds, including when JavaScript is blocked         |
| Bootstrap supervisor deadline | 150 seconds; supervisor termination closes the Job Object and its descendants              |
| Associated processes          | At most 16, with no breakaway permission                                                   |
| Concurrent suites             | Reject a second guarded suite on the same host                                             |
| Output                        | Terminate after 4 MiB; retain at most the last 64 KiB                                      |
| System memory pressure        | Refuse startup when reserve is low; stop a running suite if reserve becomes critically low |

The supervisor creates the Node process suspended, establishes the Job Object limits, assigns the process, and only then resumes it. Normal parent exit also cleans up any surviving descendants. `NODE_OPTIONS` and an outer runner's `NODE_TEST_CONTEXT` are removed from the child environment.

For smaller probes, reduce the budget explicitly:

```powershell
pwsh -NoProfile -File tests/resourceguard/runGuardedTest.ps1 -TestPath tests/resourceguard/resourceGuardFixture.cjs -MemoryLimitMiB 256 -TimeoutSeconds 5
```

The manual launcher accepts 128–2048 MiB and 1–300 seconds. For an intentionally long suite, explicitly add `-LongRunningSuite` to allow up to 1800 seconds; the default remains 120 seconds and the memory limits stay unchanged. A longer budget without that opt-in is rejected before starting Node. There is no option to disable the limits. This tool protects against accidental test failures; it is not a security sandbox for deliberately malicious tests.

## Reports and exit codes

Use `-ReportPath path/to/report.json` to save a compact report. The automatic bootstrap writes `<test-name>.guard-result.json` beside the guard tools; these generated files are ignored by Git. Reports include the reason, peak job memory, elapsed time, and active process count after cleanup.

| Exit code | Meaning                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ |
| 0         | Test passed                                                                                      |
| 1         | Test failed; `TestExitCode` preserves the child's original status                                |
| 124       | External wall-clock timeout                                                                      |
| 125       | Memory/process limit, system pressure, concurrent suite, or protection failure; inspect `Reason` |
| 126       | Output limit exceeded                                                                            |

Do not bypass the guard to rerun a rejected test. First inspect the compact report and the bounded output tail. Avoid assertions that include whole DOM nodes or React internals in their failure values; compare booleans or small scalar values instead.

## Verify protection safely

Run these scripts **sequentially**:

```powershell
pwsh -NoProfile -File tests/resourceguard/verifyResourceGuard.ps1
pwsh -NoProfile -File tests/resourceguard/verifyGuardLifecycle.ps1
```

The probes cover passing/failing tests, blocked-event-loop timeout, memory and output limits, descendant cleanup, concurrent rejection, supervisor termination, and invalid target rejection. The synthetic allocation itself is capped at 192 MiB, waits and child lifetimes at 12 seconds, and output at 5 MiB, even if protection is broken. Evidence is written only to the ignored `tests/resourceguard/guard-verification/` directory. Lifecycle verification terminates only the supervisor instances it starts and retains their process handles to avoid targeting recycled PIDs.

These probes are explicit Windows integration checks, separate from the cross-platform Vitest suite. The guard does not automatically wrap `bun run test` or `just push`; do not assume the whole repository suite has these limits. `VITEST_MAX_WORKERS=2` can bound Vitest concurrency, but a worker count alone is not a process-tree memory limit. To supervise a longer workflow, provide a CommonJS test adapter that invokes the actual workflow and propagates its exit status, then run that adapter with an explicit long-suite budget. For example, `-LongRunningSuite -TimeoutSeconds 1800 -MemoryLimitMiB 2048` retains the Job Object memory, descendant, output, and concurrency protections. Do not replace the repository's required `just push` checks with a successful guard probe.

## Windows API references

- [Job memory limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
- [Assign a suspended process to a Job Object](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- [Completion notifications and guaranteed notification limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_associate_completion_port)
