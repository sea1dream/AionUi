# Composer native clipboard regression tests

From the repository root, after installing the existing dependencies:

```sh
bunx playwright install chromium --only-shell
node tests/e2e/features/conversations/composer/runNativeClipboard.cjs
```

This standalone browser suite uses the existing `playwright`, `@playwright/test`,
and `esbuild` dependencies. It builds the current source in memory, serves it only
on a temporary loopback port, and launches a fresh headless browser. It requires
no Electron build, account, agent, API key, or user profile. A nonzero exit code
means a case failed. It is separate from the Electron E2E fixture and Vitest suite.

`AIONUI_HEADLESS_SHELL` can point to an already installed Playwright headless-shell
executable when its revision differs from the package default. The runner checks
the actual browser process command before writing any clipboard data and rejects
normal Chrome or Electron executables. It never connects to a running browser.

Paste uses `navigator.clipboard.writeText` followed by the platform's actual
Ctrl+V / Cmd+V shortcut. Undo and redo use keyboard shortcuts too. Tests require
trusted `paste`, `insertFromPaste`, `historyUndo`, and `historyRedo` events, so
synthetic no-op paste events cannot pass. No `dispatchEvent`, `insertText`,
`execCommand`, or hand-written undo stack substitutes for native editing.

Chromium's [headless shell startup](https://chromium.googlesource.com/chromium/src/+/main/headless/lib/browser/headless_browser_main_parts.cc)
installs [HeadlessClipboard](https://chromium.googlesource.com/chromium/src/+/refs/tags/135.0.7049.43/components/headless/clipboard/headless_clipboard.cc),
which derives from the [in-memory ClipboardNonBacked](https://chromium.googlesource.com/chromium/src/+/main/ui/base/clipboard/clipboard_non_backed.h).
This clipboard is independent of the operating system clipboard; the suite does
not read or replace the user's desktop clipboard.

The harness imports the real SendBox, Arco textarea, React, SWR draft hook,
PasteService/usePasteService, composition handling, and history navigation.
Peripheral IPC, uploads, speech, menus, and conversation message retrieval are
stubbed; history retrieval supplies one fixed user message to the real history
logic. This tests renderer/browser integration, not packaged Electron behavior,
file/image uploads, operating system clipboard integration, or IME behavior.

Cases cover typing, paste into an empty draft, insertion in the middle, selected
text replacement, trailing whitespace/newlines, undo/redo, history recall followed
by paste and Escape/Down, and preserving an unsent draft when focus is elsewhere.
