// src/common/sync/chatSyncTransport.switchable.ts

import type { ChatSyncTransport } from '~/common/sync/chatSyncTransport';

/**
 * Switchable transport:
 * - Start with a disabled/noop transport.
 * - Later switch to HTTP transport without recreating uploader.
 *
 * Why this exists:
 * - We want to queue dirty ops immediately (watcher can run),
 *   but we must NOT upload until we have pulled remote revisions (metadata list).
 */
export function createChatSyncTransportSwitchable(initial: ChatSyncTransport) {
  let delegate = initial;

  const transport: ChatSyncTransport = {
    get mode() {
      return delegate.mode;
    },

    upsertConversation: (req) => delegate.upsertConversation(req),
    deleteConversation: (req) => delegate.deleteConversation(req),

    listConversations: () => delegate.listConversations(),
    getConversation: (conversationId) => delegate.getConversation(conversationId),
  };

  function switchTo(next: ChatSyncTransport) {
    delegate = next;
  }

  return { transport, switchTo };
}