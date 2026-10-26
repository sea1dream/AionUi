/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageThinking } from '@/common/chat/chatLib';
import MessageThinking from '@/renderer/pages/conversation/Messages/components/MessageThinking';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

function createThinkingMessage(createdAt: number): IMessageThinking {
  return {
    id: 'thinking-1',
    type: 'thinking',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    position: 'left',
    created_at: createdAt,
    content: {
      content: 'analyzing',
      status: 'thinking',
    },
  };
}

describe('MessageThinking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps streamed thinking collapsed until the reader opens it', () => {
    const message = createThinkingMessage(Date.now());
    const { rerender } = render(<MessageThinking message={message} />);
    expect(screen.getByText('analyzing')).not.toBeVisible();

    rerender(<MessageThinking message={{ ...message, content: { ...message.content, content: 'more analysis' } }} />);
    expect(screen.getByText('more analysis')).not.toBeVisible();
    fireEvent.click(screen.getByText('Thinking... · 0s'));
    expect(screen.getByText('more analysis')).toBeVisible();
  });

  it('preserves an explicit expanded choice when thinking finishes', () => {
    const message = createThinkingMessage(Date.now());
    const { rerender } = render(<MessageThinking message={message} />);
    fireEvent.click(screen.getByText('Thinking... · 0s'));

    rerender(<MessageThinking message={{ ...message, content: { content: 'complete analysis', status: 'done' } }} />);
    expect(screen.getByText('complete analysis')).toBeVisible();
  });

  it('preserves elapsed time when the component remounts for an active thinking message', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    const createdAt = Date.now() - 5_000;

    const { unmount } = render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 5s')).toBeInTheDocument();

    unmount();

    vi.setSystemTime(new Date('2026-05-26T09:00:12.000Z'));
    render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 7s')).toBeInTheDocument();
  });
});
