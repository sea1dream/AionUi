/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Notification Module
 *
 * Provides showNotification() for direct use in main process,
 * and registers an IPC provider so renderer can invoke it cross-process.
 */

import { getPlatformServices } from '@/common/platform';
import { ipcBridge } from '@/common';
import { electronNotification } from '@/common/electronSafe';
import { ProcessConfig } from '@process/utils/initStorage';
import type { BrowserWindow, Notification } from 'electron';
import type { INotificationOptions } from '@/common/adapter/ipcBridge';
import path from 'path';
import fs from 'fs';

// Main window reference, used to gate on focus and to focus + navigate on click.
let mainWindowRef: BrowserWindow | null = null;
// Keep notification callbacks alive until explicit dismissal, click, or failure.
const activeNotifications = new Set<Notification>();

export const setNotificationMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

/**
 * Get app icon path for notifications
 */
const getNotificationIcon = (): string | undefined => {
  try {
    const resourcesPath = getPlatformServices().paths.isPackaged()
      ? process.resourcesPath
      : path.join(process.cwd(), 'resources');
    const iconPath = path.join(resourcesPath, 'app.png');
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  } catch {
    // Ignore icon error, notification will still show
  }
  return undefined;
};

/**
 * Show a system notification.
 * Can be called directly from main process or via IPC from renderer.
 *
 * Skips when `system.notificationEnabled` is off, or when the originating
 * conversation is already focused. When a real Electron notification is available,
 * clicking it focuses the main window and emits `notification.clicked` so the
 * renderer can navigate to the originating conversation.
 *
 * In non-Electron mode this falls back to the platform service, which is a no-op.
 */
export async function showNotification({
  title,
  body,
  conversation_id,
  is_current_conversation,
}: INotificationOptions): Promise<void> {
  // Check if notification is enabled
  const notificationEnabled = await ProcessConfig.get('system.notificationEnabled');
  if (notificationEnabled === false) {
    console.log('[Notification] Skipped: notifications are disabled in settings');
    return;
  }

  // Preserve focused-window suppression for legacy / non-conversation callers.
  const anotherConversation = Boolean(conversation_id) && is_current_conversation === false;
  if (mainWindowRef && !mainWindowRef.isDestroyed() && mainWindowRef.isFocused() && !anotherConversation) {
    console.log('[Notification] Skipped: main window is focused');
    return;
  }

  const iconPath = getNotificationIcon();

  // Prefer a real Electron notification so the click can focus + navigate.
  if (electronNotification) {
    try {
      const notification = new electronNotification({
        title,
        body,
        timeoutType: 'never',
        ...(iconPath ? { icon: iconPath } : {}),
      });
      activeNotifications.add(notification);
      const release = () => {
        activeNotifications.delete(notification);
      };
      notification.on('close', release);
      notification.on('failed', release);
      notification.on('click', () => {
        release();
        const win = mainWindowRef;
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        ipcBridge.notification.clicked.emit({ conversation_id });
      });
      try {
        notification.show();
      } catch (error) {
        release();
        throw error;
      }
      console.log(`[Notification] show() called (isSupported=${electronNotification.isSupported()})`);
    } catch (error) {
      console.error('[Notification] Error creating notification:', error);
    }
    return;
  }

  // Non-Electron fallback (no-op in node mode).
  try {
    getPlatformServices().notification.send({ title, body, icon: iconPath });
  } catch (error) {
    console.error('[Notification] Error creating notification:', error);
  }
}

/**
 * Register IPC provider so renderer can trigger notifications cross-process.
 */
export function initNotificationBridge(): void {
  ipcBridge.notification.show.provider(async (options) => {
    await showNotification(options);
  });
}
