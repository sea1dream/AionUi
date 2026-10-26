import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessage: {
        invoke: vi.fn(),
      },
    },
  },
}));

const makeTool = (status: string): ToolMessage => ({
  id: 'active-tool',
  conversation_id: 'conversation-1',
  type: 'tool_call',
  content: { call_id: 'active-tool', name: 'run tests', args: {}, status, output: 'test output' },
});

describe('MessageToolGroupSummary', () => {
  it('defaults running tool groups to a compact summary', () => {
    render(<MessageToolGroupSummary messages={[makeTool('running')]} />);
    expect(screen.getByText('View Steps · 1')).toBeInTheDocument();
    expect(screen.queryByText('run tests')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('View Steps · 1'));
    expect(screen.getByText('run tests')).toBeInTheDocument();
  });

  it('does not reopen a manually collapsed group when another tool starts', () => {
    const { rerender } = render(<MessageToolGroupSummary messages={[makeTool('completed')]} />);
    fireEvent.click(screen.getByText('View Steps · 1'));
    fireEvent.click(screen.getByText('View Steps · 1'));
    rerender(<MessageToolGroupSummary messages={[makeTool('running')]} />);
    expect(screen.queryByText('run tests')).not.toBeInTheDocument();
  });

  it('preserves expanded steps while their status changes', () => {
    const { rerender } = render(<MessageToolGroupSummary messages={[makeTool('completed')]} />);
    fireEvent.click(screen.getByText('View Steps · 1'));
    rerender(<MessageToolGroupSummary messages={[makeTool('running')]} />);
    expect(screen.getByText('run tests')).toBeInTheDocument();
  });

  it('loads full tool content when expanding a compact history item', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    invoke.mockResolvedValue({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'full output' } }],
        },
      },
    } as unknown as TMessage);

    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'message-1',
            conversation_id: 'conversation-1',
            type: 'acp_tool_call',
            content: {
              _compact: {
                truncated: true,
                original_size: 90000,
                preview_chars: 4096,
              },
              update: {
                session_update: 'tool_call',
                tool_call_id: 'tool-1',
                status: 'completed',
                title: 'rg',
                kind: 'search',
                raw_input: { pattern: 'needle', path: '.' },
                content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
              },
            },
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('View Steps · 1'));
    fireEvent.click(screen.getByText('rg'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      });
    });
    expect(await screen.findByText('full output')).toBeInTheDocument();
  });
});
