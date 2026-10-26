/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Framework-free core for WebUI browser notifications: pure gating and a
 * controller that turns conversation events into notification payloads.
 * Kept free of React / DOM globals so it is unit-testable in the node project.
 */

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export type NotificationGate = {
  isElectron: boolean;
  hasNotificationApi: boolean;
  isSecureContext: boolean;
  permission: NotificationPermissionState;
  settingEnabled: boolean;
  documentHidden: boolean;
  documentFocused?: boolean;
  conversationActive?: boolean;
};

export const shouldShowNotification = (gate: NotificationGate): boolean =>
  !gate.isElectron &&
  gate.hasNotificationApi &&
  gate.isSecureContext &&
  gate.permission === 'granted' &&
  gate.settingEnabled &&
  (gate.documentHidden || gate.documentFocused === false || gate.conversationActive === false);

/**
 * Max length of a conversation name embedded in a turn-completed notification.
 * The name sits at the front of the body, so anything longer is truncated with
 * a trailing ellipsis (keep the beginning, where the title's meaning is). Kept
 * as a constant so it is easy to tune in one place.
 */
export const CONVERSATION_NAME_MAX_LENGTH = 20;

/**
 * Trim a conversation name and cap it at `maxLength`, appending an ellipsis when
 * it overflows. Keeps the leading characters (front-loaded titles read best).
 */
export const truncateConversationName = (name: string, maxLength: number = CONVERSATION_NAME_MAX_LENGTH): string => {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
};

export type NotificationKind = 'confirmation' | 'turnCompleted';

export type NotificationPayload = {
  body: string;
  conversationId?: string;
  kind: NotificationKind;
};

export type BrowserNotificationDeps = {
  /**
   * Whether a notification may be shown right now. The WebUI path derives this
   * from the browser gate (`shouldShowNotification`); the desktop path uses its
   * own condition (window focus is checked in the main process). Injecting the
   * predicate keeps this controller — and its turn-finish detection / dedup —
   * shared across both paths.
   */
  shouldShow: (conversationId?: string) => boolean;
  show: (payload: NotificationPayload) => void;
  /**
   * Build the notification body for a given kind. `conversationId` is provided
   * so the turn-completed body can name the originating conversation; the
   * confirmation body ignores it.
   */
  bodyFor: (kind: NotificationKind, conversationId?: string) => string;
};

/**
 * Shape of a conversation response-stream message (`message.stream`). Both the
 * turn-finish and permission-request signals ride this single channel, keyed
 * by `type` — there is no separate `confirmation.add` / `turn.completed`
 * channel in a real conversation.
 */
export type StreamMessage = {
  type?: string;
  conversation_id?: string;
  turn_id?: string;
  /** Stable per-message id, used to dedup repeated confirmation frames
   *  (e.g. a reconnect replay re-delivering the same permission request). */
  msg_id?: string;
};

// Stream `type` values that represent the agent blocking on the user: a tool
// permission request (`acp_permission` from ACP; `permission` too from aionrs)
// or a structured question (`ask`, AskUserQuestion). All surface the same
// "needs your input" notification.
const CONFIRMATION_TYPES = new Set(['acp_permission', 'permission', 'ask']);

export const createBrowserNotificationController = (deps: BrowserNotificationDeps) => {
  // Remember interleaved conversations and events observed while focused too:
  // reconnect replays must not turn an already-read finish into a new alert.
  const seenEventKeys = new Set<string>();
  const rememberEvent = (key: string | null): boolean => {
    if (!key) return true;
    if (seenEventKeys.has(key)) return false;
    seenEventKeys.add(key);
    // Bound lifetime memory without removing any live notification.
    if (seenEventKeys.size > 2048) {
      const oldestKey = seenEventKeys.values().next().value;
      if (oldestKey !== undefined) seenEventKeys.delete(oldestKey);
    }
    return true;
  };

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    if (CONFIRMATION_TYPES.has(message.type)) {
      const dedupKey = message.msg_id
        ? JSON.stringify(['confirmation', message.conversation_id, message.msg_id])
        : null;
      if (!rememberEvent(dedupKey) || !deps.shouldShow(message.conversation_id)) return;
      deps.show({
        body: deps.bodyFor('confirmation', message.conversation_id),
        conversationId: message.conversation_id,
        kind: 'confirmation',
      });
      return;
    }

    if (message.type === 'finish') {
      const eventId = message.turn_id || message.msg_id;
      const dedupKey = eventId ? JSON.stringify(['finish', message.conversation_id, eventId]) : null;
      if (!rememberEvent(dedupKey) || !deps.shouldShow(message.conversation_id)) return;
      deps.show({
        body: deps.bodyFor('turnCompleted', message.conversation_id),
        conversationId: message.conversation_id,
        kind: 'turnCompleted',
      });
    }
  };

  return { onStreamMessage };
};
