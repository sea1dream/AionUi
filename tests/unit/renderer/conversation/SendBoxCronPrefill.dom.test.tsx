/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-prefill-conversation',
    type: 'acp',
    workspace: '/workspace',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

vi.mock('@/renderer/pages/conversation/explorer/search/useProjectMentionSearch', () => ({
  useProjectMentionSearch: () => ({
    active: true,
    loading: false,
    peNames: {},
    items: [{ name: 'alpha.ts', path: '/workspace/alpha.ts', relativePath: 'alpha.ts', isFile: true }],
  }),
}));

vi.mock('@/renderer/hooks/chat/useSessionMentionSearch', () => ({
  useSessionMentionSearch: () => ({
    items: [{ id: 'target-conversation', name: 'Target', modified_at: 0 }],
    loading: false,
    loadMore: vi.fn(),
    hasMore: false,
  }),
}));

import SendBox from '@/renderer/components/chat/SendBox';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';

const SendBoxHarness = () => {
  const [value, setValue] = useState('Existing draft');
  return <SendBox value={value} onChange={setValue} onSend={vi.fn().mockResolvedValue(undefined)} />;
};

describe('SendBox scheduled-task prefill', () => {
  it('preserves the draft, focuses the mounted desktop input, and moves the caret to the end', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>Outside focus target</button>
        <SendBoxHarness />
      </div>
    );

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'Outside focus target' }).focus();
    expect(textarea).not.toHaveFocus();

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Create with /cron in AionUi');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nCreate with /cron in AionUi'));
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });

  it('does not force focus on mobile', async () => {
    layoutState.isMobile = true;
    render(
      <div>
        <button type='button'>Mobile outside target</button>
        <SendBoxHarness />
      </div>
    );

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'Mobile outside target' }).focus();

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Create with /cron in AionUi');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nCreate with /cron in AionUi'));
    expect(textarea).not.toHaveFocus();
  });

  it('chains consecutive requests before the controlled value rerenders', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'First /cron prompt');
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Second /cron prompt');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nFirst /cron prompt\nSecond /cron prompt'));
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });

  it('keeps the prefill when the textarea cannot be focused', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    outsideTarget.focus();

    const originalQuerySelector = Element.prototype.querySelector;
    const querySelectorSpy = vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (selector) {
      if (selector === 'textarea' && (this as Element).classList.contains('sendbox-panel')) return null;
      return originalQuerySelector.call(this, selector);
    });

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Create with /cron in AionUi');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nCreate with /cron in AionUi'));
    expect(outsideTarget).toHaveFocus();

    querySelectorSpy.mockRestore();
    outsideTarget.remove();
  });
});

const KeyboardHarness = ({ initialValue, onSend }: { initialValue: string; onSend: () => Promise<void> }) => {
  const [value, setValue] = useState(initialValue);
  return (
    <SendBox
      value={value}
      onChange={setValue}
      onSend={onSend}
      crossSessionEnabled
      slash_commands={[{ name: 'review', description: 'Review', kind: 'template', source: 'acp' }]}
    />
  );
};

const pressKey = (textarea: HTMLTextAreaElement, key: string, modifiers: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  act(() => {
    textarea.dispatchEvent(event);
  });
  return event;
};

describe.each([
  { menu: 'file', query: '@al', candidate: 'alpha.ts', acceptedValue: '@alpha.ts ' },
  { menu: 'session', query: '@@Ta', candidate: 'Target', acceptedValue: '@@Target ' },
])('SendBox $menu mention keyboard shortcuts', ({ query, candidate, acceptedValue }) => {
  const renderOpenMenu = async () => {
    layoutState.isMobile = false;
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<KeyboardHarness initialValue={query} onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.select(textarea, { target: { selectionStart: query.length, selectionEnd: query.length } });
    await waitFor(() => expect(screen.getAllByText(candidate).length).toBeGreaterThan(0));
    return { textarea, onSend };
  };

  it.each([
    ['Shift+Enter', 'Enter', { shiftKey: true }],
    ['Shift+Tab', 'Tab', { shiftKey: true }],
    ['Ctrl+Tab', 'Tab', { ctrlKey: true }],
    ['Shift+ArrowDown', 'ArrowDown', { shiftKey: true }],
  ] as const)('does not consume %s while candidates are visible', async (_label, key, modifiers) => {
    const { textarea, onSend } = await renderOpenMenu();
    const event = pressKey(textarea, key, modifiers);

    // jsdom does not perform native editing or focus traversal. Leaving the
    // event uncancelled lets the browser perform that default action.
    expect(event.defaultPrevented).toBe(false);
    expect(textarea).toHaveValue(query);
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'Tab'])('still accepts the candidate with plain %s', async (key) => {
    const { textarea, onSend } = await renderOpenMenu();
    const event = pressKey(textarea, key);

    expect(event.defaultPrevented).toBe(true);
    expect(textarea).toHaveValue(acceptedValue);
    expect(onSend).not.toHaveBeenCalled();
  });
});

it('does not consume Ctrl+Tab or insert a slash command', () => {
  layoutState.isMobile = false;
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(<KeyboardHarness initialValue='/rev' onSend={onSend} />);
  const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
  const event = pressKey(textarea, 'Tab', { ctrlKey: true });

  expect(event.defaultPrevented).toBe(false);
  expect(textarea).toHaveValue('/rev');
  expect(onSend).not.toHaveBeenCalled();
});
