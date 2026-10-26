'use strict';

require('./testSafety.cjs').ensureGuarded(__filename);

// Bounded, synthetic safety probes. Even without a working guard, allocation is
// limited to 192 MiB and all deliberate waits/busy loops finish within 12 seconds.
// Run one mode at a time through runGuardedTest.ps1, never against user data.
const mode = process.env.AIONUI_RESOURCE_FIXTURE_MODE || 'pass';
if (process.argv.includes('--guard-fixture-child')) {
  process.stdout.write(`fixture-child-ready pid=${process.pid}\n`);
  if (process.send) process.send({ ready: true, pid: process.pid });
  const pulse = setInterval(() => {}, 100);
  setTimeout(() => {
    clearInterval(pulse);
    process.exit(0);
  }, 12000);
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function startChild() {
    const child = spawn(process.execPath, [__filename, '--guard-fixture-child'], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    process.stdout.write(`fixture-child-spawned pid=${child.pid}\n`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture child did not become ready')), 2000);
      child.once('message', (message) => {
        clearTimeout(timer);
        if (message?.ready === true) resolve();
        else reject(new Error('Unexpected fixture child message'));
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Fixture child exited early: ${code}`));
      });
    });
    child.disconnect();
    child.unref();
    return child;
  }

  test(`resource guard bounded fixture: ${mode}`, async () => {
    switch (mode) {
      case 'pass':
        assert.equal(2 + 2, 4);
        break;
      case 'fail':
        assert.equal(1, 2, 'Expected synthetic assertion failure');
        break;
      case 'timeout': {
        await startChild();
        // External wall-clock enforcement must work while JavaScript is blocked.
        const end = Date.now() + 10000;
        while (Date.now() < end) {
          /* bounded 10-second busy loop */
        }
        break;
      }
      case 'descendant':
        await startChild();
        process.stdout.write('fixture-parent-normal-exit\n');
        process.exit(0);
        break;
      case 'memory': {
        const allocations = [];
        try {
          for (let i = 0; i < 96; i++) {
            allocations.push(Buffer.alloc(2 * 1024 * 1024, 0x5a));
            await pause(10);
          }
        } catch (error) {
          process.stderr.write(`fixture-allocation-rejected ${error?.name || 'Error'}\n`);
        }
        process.stdout.write(`fixture-allocation-count=${allocations.length}\n`);
        await pause(1500);
        // Retain buffers during the pause without dumping their contents.
        assert.ok(allocations.length <= 96);
        break;
      }
      case 'output': {
        const chunk = Buffer.alloc(64 * 1024, 0x78);
        for (let i = 0; i < 80; i++) {
          if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
        }
        break;
      }
      default:
        throw new Error(`Unknown bounded fixture mode: ${mode}`);
    }
  });
}
