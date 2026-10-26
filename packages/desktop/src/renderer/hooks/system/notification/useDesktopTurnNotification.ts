/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { getSnapshotConversationName } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { getCurrentConversation } from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { createBrowserNotificationController, truncateConversationName } from './browserNotificationCore';

/**
 * Desktop-only: fire a native system notification when an agent turn finishes.
 * Reuses the same turn-finish detection as the WebUI path
 * (`createBrowserNotificationController`) rather than inventing a second one.
 *
 * The renderer only reports "a turn finished"; the main-process notification
 * bridge decides whether to actually show it (it skips only when the originating
 * conversation is focused and respects `system.notificationEnabled`). Clicks are handled by
 * `useNotificationClick`, which navigates to the originating conversation.
 *
 * No-op outside the Electron desktop runtime (the WebUI uses
 * `useBrowserNotification` instead).
 */
export const useDesktopTurnNotification = (): void => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isElectronDesktop()) return;

    const streamEmitter = ipcBridge.conversation?.responseStream;
    if (!streamEmitter) return;

    const controller = createBrowserNotificationController({
      // Cheap renderer-side gate; the main process still re-checks the setting
      // and the window-focus condition before showing anything.
      shouldShow: () => configService.get('system.notificationEnabled') !== false,
      bodyFor: (kind, conversationId) => {
        const name = conversationId ? getSnapshotConversationName(conversationId) : undefined;
        if (kind === 'confirmation') {
          return name
            ? t('settings.browserNotification.bodyConfirmationNamed', { name: truncateConversationName(name) })
            : t('settings.browserNotification.bodyConfirmation');
        }
        return name
          ? t('settings.browserNotification.bodyTurnCompletedNamed', { name: truncateConversationName(name) })
          : t('settings.browserNotification.bodyTurnCompleted');
      },
      show: ({ body, conversationId }) => {
        // Read selection at event time, including the active member in a team.
        // Main combines this with the actual native-window focus state.
        void ipcBridge.notification.show.invoke({
          title: 'AionUi',
          body,
          conversation_id: conversationId,
          is_current_conversation: Boolean(conversationId && getCurrentConversation() === conversationId),
        });
      },
    });

    const disposeStream = streamEmitter.on(controller.onStreamMessage);
    return () => {
      disposeStream();
    };
  }, [t]);
};
