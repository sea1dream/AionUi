/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { File as NodeFile } from 'node:buffer';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
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
    conversation_id: 'sendbox-active-focus-conversation',
    type: 'acp',
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

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
  trackUpload: () => ({ onProgress: vi.fn(), finish: vi.fn() }),
}));

vi.mock('@/renderer/services/FileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/services/FileService')>()),
  uploadFileViaHttp: vi.fn().mockResolvedValue('/managed/image-1.png'),
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

import SendBox from '@/renderer/components/chat/SendBox';
import { PasteService } from '@/renderer/services/PasteService';

afterEach(() => {
  cleanup();
  PasteService.destroy();
});

const SendBoxHarness = ({
  active,
  onFocused,
  disabled,
  initialValue = '',
  onSend = vi.fn().mockResolvedValue(undefined),
  onAddToDraft,
  onFilesAdded,
}: {
  active?: boolean;
  onFocused?: () => void;
  disabled?: boolean;
  initialValue?: string;
  onSend?: (message: string) => Promise<void | false>;
  onAddToDraft?: () => void;
  onFilesAdded?: React.ComponentProps<typeof SendBox>['onFilesAdded'];
}) => {
  const [value, setValue] = useState(initialValue);
  return (
    <SendBox
      value={value}
      onChange={setValue}
      onSend={onSend}
      active={active}
      onFocused={onFocused}
      disabled={disabled}
      onAddToDraft={onAddToDraft}
      onFilesAdded={onFilesAdded}
    />
  );
};

describe('SendBox active-controlled focus', () => {
  it('keeps Enter mapped to Send while Draft box has its own icon action', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onAddToDraft = vi.fn();

    render(<SendBoxHarness initialValue='queued draft' onSend={onSend} onAddToDraft={onAddToDraft} />);
    fireEvent.click(screen.getByTestId('sendbox-add-to-draft-btn'));

    expect(onAddToDraft).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    const textarea = screen.getByTestId('sendbox-input');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('queued draft');
  });

  it('restores the input when the parent blocks sending', async () => {
    const onSend = vi.fn().mockResolvedValue(false);

    render(<SendBoxHarness initialValue='blocked message' onSend={onSend} />);

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('blocked message');
    await waitFor(() => expect(textarea.value).toBe('blocked message'));
  });

  it('uses the platform primary Enter shortcut for Draft box without sending', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onAddToDraft = vi.fn();

    render(<SendBoxHarness initialValue='save this for later' onSend={onSend} onAddToDraft={onAddToDraft} />);

    const textarea = screen.getByTestId('sendbox-input');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onAddToDraft).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('focuses the textarea on mount when active is true (desktop)', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness active={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('focuses on mount when active is omitted (default true, preserves single-conversation behavior)', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('does NOT focus on mount when active is false', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>outside</button>
        <SendBoxHarness active={false} />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'outside' }).focus();
    await waitFor(() => expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus());
    expect(textarea).not.toHaveFocus();
  });

  it('does not force focus on mobile even when active', async () => {
    layoutState.isMobile = true;
    render(
      <div>
        <button type='button'>outside</button>
        <SendBoxHarness active={true} />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'outside' }).focus();
    expect(textarea).not.toHaveFocus();
  });

  it('calls onFocused when the textarea gains focus', () => {
    layoutState.isMobile = false;
    const onFocused = vi.fn();
    render(<SendBoxHarness active={false} onFocused={onFocused} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
    });
    expect(onFocused).toHaveBeenCalledTimes(1);
  });
});

describe('SendBox text paste ownership', () => {
  it('leaves text insertion to the native editor without replacing the controlled value', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness initialValue='draft BEFORE after' />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 12);
    const event = createEvent.paste(textarea, {
      clipboardData: { getData: () => 'PASTED\n', files: [] },
    });

    // jsdom has no native paste default action; assert the application's boundary.
    await act(async () => {
      fireEvent(textarea, event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(textarea.value).toBe('draft BEFORE after');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 12]);
  });

  it('keeps the draft unchanged when text is pasted outside the focused composer', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>outside paste target</button>
        <SendBoxHarness initialValue='draft to keep' />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    const outside = screen.getByRole('button', { name: 'outside paste target' });
    act(() => outside.focus());
    await act(async () => {
      fireEvent.paste(outside, { clipboardData: { getData: () => 'PASTED', files: [] } });
    });

    expect(textarea.value).toBe('draft to keep');
    expect(outside).toHaveFocus();
  });

  it('still cancels image paste synchronously and attaches the uploaded file without inserting its text', async () => {
    layoutState.isMobile = false;
    const onFilesAdded = vi.fn();
    render(<SendBoxHarness initialValue='draft to keep' onFilesAdded={onFilesAdded} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    const file = new NodeFile(['image bytes'], 'image.png', { type: 'image/png' });
    const event = createEvent.paste(textarea, {
      clipboardData: { getData: () => 'image.png', files: [file] },
    });
    fireEvent(textarea, event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(onFilesAdded).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'image-1.png', path: '/managed/image-1.png', type: 'image/png' }),
      ])
    );
    expect(textarea.value).toBe('draft to keep');
  });
});

describe('SendBox selection→focus downward effect', () => {
  it('focuses when active transitions false→true', async () => {
    layoutState.isMobile = false;
    const { rerender } = render(<SendBoxHarness active={false} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    expect(textarea).not.toHaveFocus();
    rerender(<SendBoxHarness active={true} />);
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('focuses once textarea becomes enabled while active (warmup recovery)', async () => {
    layoutState.isMobile = false;
    const { rerender } = render(<SendBoxHarness active={true} disabled={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    expect(textarea).not.toHaveFocus();
    rerender(<SendBoxHarness active={true} disabled={false} />);
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('does not move the caret if the box is already focused when it becomes active', async () => {
    layoutState.isMobile = false;
    const { rerender } = render(<SendBoxHarness active={false} initialValue='hello world' />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(2, 2);
    });
    rerender(<SendBoxHarness active={true} initialValue='hello world' />);
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.selectionStart).toBe(2);
  });

  it('never focuses while active stays false', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>outside</button>
        <SendBoxHarness active={false} />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'outside' }).focus();
    await waitFor(() => expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus());
    expect(textarea).not.toHaveFocus();
  });
});
