// src/common/sync/chatSyncCodec.ts

import type { DConversation } from '~/common/stores/chat/chat.conversation';
import type { DMessage } from '~/common/stores/chat/chat.message';

/**
 * This is the "sanitized" message shape we will sync:
 * tokenCount is a local cache; do not sync it.
 */
export type SyncMessage = Omit<DMessage, 'tokenCount'>;

/**
 * This is the "sanitized" conversation shape we will sync:
 * we remove transient / local-only fields and cache-like token counts.
 */
export type SyncConversation =
  Omit<DConversation, '_abortController' | '_isIncognito' | 'tokenCount' | 'messages'>
  & {
    messages: SyncMessage[];
  };

/**
 * Policy:
 * - Never sync incognito conversations.
 * - Never sync placeholder empties (no messages, no titles).
 */
export function isConversationSyncEligible(c: DConversation): boolean {
  // Never sync incognito
  if (c._isIncognito) return false;

  // Never sync placeholder empties
  const hasMessages = !!c.messages?.length;
  const hasTitle = !!c.userTitle || !!c.autoTitle;
  return hasMessages || hasTitle;
}

export function sanitizeMessageForSync(m: DMessage): SyncMessage {
  // tokenCount is a cache; different devices may compute different values.
  // NOTE: we do not mutate the original message object.
  const { tokenCount: _tokenCount, ...rest } = m;
  return rest;
}

export function sanitizeConversationForSync(c: DConversation): SyncConversation {
  // Do NOT send transient fields like AbortController, never sync _isIncognito,
  // and do not sync tokenCount cache values to prevent cross-device churn.
  const {
    _abortController,
    _isIncognito,
    tokenCount: _conversationTokenCount,
    messages,
    ...rest
  } = c;

  return {
    ...rest,
    messages: (messages || []).map(sanitizeMessageForSync),
  };
}