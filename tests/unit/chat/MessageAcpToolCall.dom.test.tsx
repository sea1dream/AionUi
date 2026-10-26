/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpTerminalOutput, IMessageAcpToolCall } from '@/common/chat/chatLib';
import type { FileChangesPanelProps } from '@/renderer/components/base/FileChangesPanel';
import MessageAcpToolCall from '@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall';
import MessageAcpTerminalOutput from '@/renderer/pages/conversation/Messages/acp/MessageAcpTerminalOutput';
import MessageFileChanges from '@/renderer/pages/conversation/Messages/MessageFileChanges';

const mockDownloadFileFromPath = vi.fn().mockResolvedValue(undefined);
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();
const mockKillTerminal = vi.fn().mockResolvedValue(undefined);

vi.mock('@/common', () => ({
  ipcBridge: { conversation: { killTerminal: { invoke: (...args: unknown[]) => mockKillTerminal(...args) } } },
}));

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} data-testid='local-image' />
  ),
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: (...args: unknown[]) => mockDownloadFileFromPath(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    loading: _loading,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Message: {
    useMessage: () => [{ success: mockMessageSuccess, error: mockMessageError }, null],
  },
}));

vi.mock('@renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/FileChangesPanel', () => ({
  __esModule: true,
  default: ({ title, files, defaultExpanded }: FileChangesPanelProps) => (
    <div
      data-testid='file-changes-panel'
      data-title={title}
      data-insertions={files[0]?.insertions ?? 0}
      data-deletions={files[0]?.deletions ?? 0}
      data-expanded={defaultExpanded}
    />
  ),
}));

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({ launchPreview: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useDiffPreviewHandlers', () => ({
  useDiffPreviewHandlers: () => ({
    handleFileClick: vi.fn(),
    handleDiffClick: vi.fn(),
  }),
}));

const createMessage = (update: IMessageAcpToolCall['content']['update']): IMessageAcpToolCall => ({
  id: 'msg-1',
  msg_id: 'msg-1',
  conversation_id: 'conv-1',
  type: 'acp_tool_call',
  content: {
    sessionId: 'sess-1',
    update,
  },
});

const baseUpdate: IMessageAcpToolCall['content']['update'] = {
  sessionUpdate: 'tool_call_update',
  tool_call_id: 'ig_test_image',
  status: 'completed',
  title: 'Image generation',
  kind: 'execute',
};

describe('MessageAcpToolCall image output', () => {
  beforeEach(() => {
    mockDownloadFileFromPath.mockReset();
    mockDownloadFileFromPath.mockResolvedValue(undefined);
    mockMessageSuccess.mockClear();
    mockMessageError.mockClear();
  });

  it('renders nothing when update content is missing', () => {
    const { container } = render(
      <MessageAcpToolCall
        message={
          {
            id: 'msg-empty',
            conversation_id: 'conv-1',
            type: 'acp_tool_call',
            content: undefined,
          } as unknown as IMessageAcpToolCall
        }
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the image path from rawOutput.image.path', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawOutput: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
        })}
      />
    );

    const image = screen.getByTestId('local-image');
    expect(image).toHaveAttribute('src', '/Users/test/.codex/generated_images/session/ig_test_image.png');
    expect(image).toHaveAttribute('alt', 'ig_test_image.png');
  });

  it('downloads the image from rawOutput.image.path', () => {
    const imagePath = '/Users/test/.codex/generated_images/session/ig_test_image.png';
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawOutput: {
            image: {
              path: imagePath,
            },
          },
        })}
      />
    );

    screen.getByLabelText('acp.image.download_aria').click();

    expect(mockDownloadFileFromPath).toHaveBeenCalledWith(imagePath, 'ig_test_image.png');
  });

  it('shows an error when image download fails', async () => {
    const imagePath = '/Users/test/.codex/generated_images/session/ig_test_image.png';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDownloadFileFromPath.mockRejectedValueOnce(new Error('denied'));

    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawOutput: {
            image: {
              path: imagePath,
            },
          },
        })}
      />
    );

    screen.getByLabelText('acp.image.download_aria').click();

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('acp.image.download_error');
    });
    expect(consoleError).toHaveBeenCalledWith('[MessageAcpToolCall] Failed to download image:', expect.any(Error));
    expect(mockMessageSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('uses i18n keys for image download labels', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawOutput: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
        })}
      />
    );

    expect(screen.getByLabelText('acp.image.download_aria')).toBeInTheDocument();
  });

  it('falls back to raw_output.saved_path for persisted snake_case content', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          raw_output: {
            saved_path: '/Users/test/.codex/generated_images/session/ig_legacy.webp',
          },
        })}
      />
    );

    const image = screen.getByTestId('local-image');
    expect(image).toHaveAttribute('src', '/Users/test/.codex/generated_images/session/ig_legacy.webp');
    expect(image).toHaveAttribute('alt', 'ig_legacy.webp');
  });

  it('uses the generated image fallback alt when the path has no file name', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawOutput: {
            image: {
              path: '/',
            },
          },
        })}
      />
    );

    expect(screen.getByTestId('local-image')).toHaveAttribute('alt', 'acp.image.generated_alt');
  });

  it('renders kind fallback labels when title is missing', () => {
    const cases: Array<[IMessageAcpToolCall['content']['update']['kind'], string]> = [
      ['edit', 'File Edit'],
      ['read', 'File Read'],
      ['execute', 'Shell Command'],
      ['custom' as IMessageAcpToolCall['content']['update']['kind'], 'custom'],
    ];

    for (const [kind, label] of cases) {
      const { unmount } = render(
        <MessageAcpToolCall
          message={createMessage({
            ...baseUpdate,
            title: '',
            kind,
          })}
        />
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders status labels for pending and in-progress states', () => {
    const { rerender } = render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          status: 'pending',
        })}
      />
    );
    expect(screen.getByText('Pending')).toBeInTheDocument();

    rerender(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          status: 'in_progress',
        })}
      />
    );
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders raw input and content variants', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawInput: { prompt: '一只小猫' },
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'done',
              },
            },
            {
              type: 'diff',
              path: '/workspace/file.ts',
              old_text: 'old',
              new_text: 'new',
            },
            {
              type: 'diff',
              path: '/workspace/second.ts',
              old_text: 'before',
              new_text: 'after',
            },
            {
              type: 'content',
              content: {
                type: 'text',
                text: '',
              },
            },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
    expect(screen.getByText(/"prompt": "一只小猫"/)).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getAllByTestId('file-changes-panel')).toHaveLength(2);
  });

  it('calculates insertion and deletion totals from complete ACP diff content', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          content: [
            {
              type: 'diff',
              path: '/workspace/file.ts',
              old_text: ['kept', 'removed', 'tail'].join('\n'),
              new_text: ['kept', 'added one', 'added two', 'tail'].join('\n'),
            },
          ],
        })}
      />
    );

    const panel = screen.getByTestId('file-changes-panel');
    expect(panel).toHaveAttribute('data-title', 'file.ts');
    expect(panel).toHaveAttribute('data-insertions', '2');
    expect(panel).toHaveAttribute('data-deletions', '1');
  });

  it('shows a diff-only file change without duplicate tool details', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawInput: { path: '/workspace/file.ts' },
          content: [
            {
              type: 'diff',
              path: '/workspace/file.ts',
              old_text: 'before',
              new_text: 'after',
            },
          ],
        })}
      />
    );

    expect(screen.getByTestId('file-changes-panel')).toBeInTheDocument();
    expect(screen.queryByText(/Tool Call ID/)).not.toBeInTheDocument();
    expect(screen.queryByText(/workspace\/file.ts/)).not.toBeInTheDocument();
  });

  it('renders string raw input as markdown', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          rawInput: 'echo hello',
        })}
      />
    );

    expect(screen.queryByText(/echo hello/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
  });

  it('keeps manually expanded tool output open while streaming and completing', () => {
    const message = createMessage({ ...baseUpdate, status: 'in_progress', rawInput: 'echo hello' });
    const { rerender } = render(<MessageAcpToolCall message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
    rerender(<MessageAcpToolCall message={createMessage({ ...message.content.update, status: 'completed' })} />);
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.collapse' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('can receive a delayed tool update after an empty initial payload', () => {
    const incomplete = { ...createMessage(baseUpdate), content: undefined } as unknown as IMessageAcpToolCall;
    const { container, rerender } = render(<MessageAcpToolCall message={incomplete} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<MessageAcpToolCall message={createMessage({ ...baseUpdate, rawInput: 'echo hello' })} />);
    expect(screen.getByText('Image generation')).toBeInTheDocument();
    expect(screen.queryByText(/echo hello/)).not.toBeInTheDocument();
  });

  it('renders an empty diff content with fallback file metadata', () => {
    render(
      <MessageAcpToolCall
        message={createMessage({
          ...baseUpdate,
          content: [
            {
              type: 'diff',
            },
          ],
        })}
      />
    );

    expect(screen.getByTestId('file-changes-panel')).toBeInTheDocument();
  });
});

describe('MessageAcpTerminalOutput collapsed output', () => {
  const message: IMessageAcpTerminalOutput = {
    id: 'terminal-1',
    conversation_id: 'conv-1',
    type: 'acp_terminal_output',
    content: { terminal_id: 'term-1', command: 'node script.js', output: 'first line' },
  };

  it('keeps output folded but leaves the command, status and stop action visible', () => {
    render(<MessageAcpTerminalOutput message={message} />);
    expect(screen.queryByTestId('terminal-card-output')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-card-command')).toHaveTextContent('node script.js');
    fireEvent.click(screen.getByTestId('terminal-card-stop'));
    expect(mockKillTerminal).toHaveBeenCalledWith({ conversation_id: 'conv-1', terminal_id: 'term-1' });
  });

  it('preserves a reader expansion while terminal output changes', () => {
    const { rerender } = render(<MessageAcpTerminalOutput message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
    rerender(
      <MessageAcpTerminalOutput message={{ ...message, content: { ...message.content, output: 'next line' } }} />
    );
    expect(screen.getByTestId('terminal-card-output')).toHaveTextContent('next line');
    fireEvent.click(screen.getByRole('button', { name: 'common.collapse' }));
    expect(screen.queryByTestId('terminal-card-output')).not.toBeInTheDocument();
  });

  it('keeps an explicit expansion when a terminal reports failure', () => {
    const { rerender } = render(<MessageAcpTerminalOutput message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
    rerender(
      <MessageAcpTerminalOutput
        message={{ ...message, content: { ...message.content, exit_status: { exit_code: 1 } } }}
      />
    );
    expect(screen.getByTestId('terminal-card-output')).toHaveTextContent('first line');
    expect(screen.queryByTestId('terminal-card-stop')).not.toBeInTheDocument();
  });

  it('does not render a broken terminal message without its identifier', () => {
    const { container } = render(
      <MessageAcpTerminalOutput message={{ ...message, content: { ...message.content, terminal_id: '' } }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('file change activity summary', () => {
  it('keeps the file list collapsed when showing a change summary', () => {
    render(
      <MessageFileChanges
        diffsChanges={[
          { file_name: 'first.ts', fullPath: '/workspace/first.ts', insertions: 1, deletions: 0, diff: '' },
          { file_name: 'second.ts', fullPath: '/workspace/second.ts', insertions: 1, deletions: 0, diff: '' },
        ]}
      />
    );
    expect(screen.getByTestId('file-changes-panel')).toHaveAttribute('data-expanded', 'false');
  });

  it('does not show an empty file change summary', () => {
    const { container } = render(<MessageFileChanges />);
    expect(container).toBeEmptyDOMElement();
  });
});
