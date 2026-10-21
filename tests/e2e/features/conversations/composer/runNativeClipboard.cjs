const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const { buildHarness } = require('./buildHarness.cjs');

// The browser-process clipboard is shared, so clipboard cases must run serially.
/* eslint-disable no-await-in-loop */

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

async function expectDraft(page, value) {
  await expect(page.getByTestId('sendbox-input')).toHaveValue(value);
  await expect.poll(() => page.getByTestId('draft').textContent()).toBe(value);
}

async function paste(page, text, target = page.getByTestId('sendbox-input')) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  const count = await page.evaluate(() => window.composerEvents.filter((event) => event.type === 'paste').length);
  await target.press(`${modifier}+v`);
  await expect
    .poll(() => page.evaluate(() => window.composerEvents.filter((event) => event.type === 'paste').length))
    .toBe(count + 1);
  const event = await page.evaluate(() => window.composerEvents.findLast((entry) => entry.type === 'paste'));
  assert.equal(event.isTrusted, true, 'Paste must be dispatched by Chromium, not a synthetic ClipboardEvent');
}

async function expectPasteUndoRedo(page, original, pasted) {
  const input = page.getByTestId('sendbox-input');
  await expectDraft(page, pasted);
  await input.press(`${modifier}+z`);
  await expectDraft(page, original);
  await input.press(redo);
  await expectDraft(page, pasted);
  const inputTypes = await page.evaluate(() =>
    window.composerEvents.filter((event) => event.type === 'input' && event.isTrusted).map((event) => event.inputType)
  );
  for (const type of ['insertFromPaste', 'historyUndo', 'historyRedo']) {
    assert.ok(inputTypes.includes(type), `Missing trusted native ${type} editing event`);
  }
}

const cases = [
  [
    'ordinary typing supports native undo and redo',
    async (page, input) => {
      await input.pressSequentially('x');
      await expectDraft(page, 'x');
      await input.press(`${modifier}+z`);
      await expectDraft(page, '');
      await input.press(redo);
      await expectDraft(page, 'x');
    },
  ],
  [
    'paste into an empty draft supports native undo and redo',
    async (page) => {
      await paste(page, 'pasted');
      await expectPasteUndoRedo(page, '', 'pasted');
    },
  ],
  [
    'paste in the middle preserves surrounding text and supports undo',
    async (page, input) => {
      await input.pressSequentially('hello world');
      await input.evaluate((element) => element.setSelectionRange(5, 5));
      await paste(page, ' pasted');
      await expectPasteUndoRedo(page, 'hello world', 'hello pasted world');
    },
  ],
  [
    'paste replaces the selected text as one undoable edit',
    async (page, input) => {
      await input.pressSequentially('hello world');
      await input.evaluate((element) => element.setSelectionRange(6, 11));
      await paste(page, 'friend');
      await expectPasteUndoRedo(page, 'hello world', 'hello friend');
    },
  ],
  [
    'paste preserves trailing newlines and whitespace',
    async (page) => {
      await paste(page, 'first\nsecond\n \n');
      await expectPasteUndoRedo(page, '', 'first\nsecond\n \n');
    },
  ],
  ...['Escape', 'ArrowDown'].map((key) => [
    `pasting into recalled history keeps the edit after ${key}`,
    async (page, input) => {
      await input.pressSequentially('unsent draft');
      await input.press('ArrowUp');
      await expectDraft(page, 'previous prompt');
      await input.press('End');
      await paste(page, ' plus paste');
      await expectDraft(page, 'previous prompt plus paste');
      await input.press(key);
      await expectDraft(page, 'previous prompt plus paste');
    },
  ]),
  [
    'paste outside the composer leaves the unsent draft unchanged',
    async (page, input) => {
      await input.pressSequentially('keep this unsent draft');
      const outside = page.getByTestId('outside-composer');
      await outside.focus();
      await paste(page, 'unrelated clipboard text', outside);
      await expectDraft(page, 'keep this unsent draft');
      await input.focus();
      await input.press(`${modifier}+z`);
      await expect(input).not.toHaveValue('keep this unsent draft');
      await input.press(redo);
      await expectDraft(page, 'keep this unsent draft');
    },
  ],
];

async function main() {
  const bundle = await buildHarness();
  const server = http.createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(bundle);
    } else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
    } else {
      response.writeHead(404).end();
    }
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({
      headless: true,
      ...(process.env.AIONUI_HEADLESS_SHELL ? { executablePath: process.env.AIONUI_HEADLESS_SHELL } : {}),
    });

    // Check before any clipboard access. The headless shell installs its own
    // ClipboardNonBacked; a normal Chrome/Electron binary is not accepted.
    const session = await browser.newBrowserCDPSession();
    const { arguments: command } = await session.send('Browser.getBrowserCommandLine');
    assert.match(path.basename(command[0]), /^(chrome-)?headless[-_]shell(?:\.exe)?$/i);
    await session.detach();
    console.log(`Native clipboard regression tests: Chromium ${browser.version()} (headless shell)`);

    let failures = 0;
    for (const [name, run] of cases) {
      const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.composerEvents = [];
        for (const type of ['paste', 'beforeinput', 'input']) {
          document.addEventListener(
            type,
            (event) => {
              window.composerEvents.push({ type, isTrusted: event.isTrusted, inputType: event.inputType });
            },
            true
          );
        }
      });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const input = page.getByTestId('sendbox-input');
        await input.focus();
        await run(page, input);
        assert.deepEqual(errors, [], 'The real composer must render without runtime errors');
        console.log(`PASS ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}\n${error.stack}`);
      } finally {
        await context.close();
      }
    }
    console.log(`${cases.length - failures}/${cases.length} passed`);
    if (failures) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
