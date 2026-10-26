'use strict';

// Keep this bootstrap ahead of React, jsdom, TypeScript, and bundle parsing.
// The environment marker is an internal hand-off, not a security boundary
// against tests deliberately trying to evade the launcher.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function ensureGuarded(testPath) {
  const target = path.resolve(testPath);
  const handedOffPath = process.env.AIONUI_TEST_RESOURCE_GUARD_PATH;
  if (process.platform !== 'win32') {
    throw new Error('These installed-bundle tests require the Windows resource guard. Refusing an unprotected run.');
  }
  if (
    process.env.AIONUI_TEST_RESOURCE_GUARDED === '1' &&
    handedOffPath &&
    path.resolve(handedOffPath).toLowerCase() === target.toLowerCase()
  ) {
    return;
  }

  const env = { ...process.env };
  // An outer node --test worker must not pass its binary test-event transport
  // or arbitrary preloads into the independent, bounded child test runner.
  const excluded = new Set([
    'NODE_TEST_CONTEXT',
    'NODE_OPTIONS',
    'AIONUI_TEST_RESOURCE_GUARDED',
    'AIONUI_TEST_RESOURCE_GUARD_PATH',
  ]);
  for (const name of Object.keys(env)) {
    if (excluded.has(name.toUpperCase())) delete env[name];
  }
  const result = spawnSync(
    'pwsh.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(__dirname, 'runGuardedTest.ps1'),
      '-NodePath',
      process.execPath,
      '-TestPath',
      target,
      '-MemoryLimitMiB',
      '1536',
      '-TimeoutSeconds',
      '120',
      '-ReportPath',
      path.join(__dirname, `${path.basename(target)}.guard-result.json`),
    ],
    {
      cwd: __dirname,
      env,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      // Secondary deadline for the supervisor itself. Its Job handle is closed
      // by Windows on termination, which also kills every guarded descendant.
      timeout: 150_000,
    }
  );
  if (result.error) {
    console.error(
      `Resource guard could not complete (${result.error.code || 'launch error'}). Test was not retried without protection.`
    );
  }
  process.exit(Number.isInteger(result.status) ? result.status : 125);
}

module.exports = { ensureGuarded };
