// src/common/sync/chatSyncTransport.noop.ts

import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type {
  ChatSyncDeleteRequest,
  ChatSyncDeleteResponse,
  ChatSyncGetConversationResponse,
  ChatSyncListConversationsResponse,
  ChatSyncResult,
  ChatSyncTransport,
  ChatSyncUpsertRequest,
  ChatSyncUpsertResponse,
} from '~/common/sync/chatSyncTransport';

export function createChatSyncTransportNoop(): ChatSyncTransport {
  const disabled = <T,>(what: string): ChatSyncResult<T> => ({
    ok: false,
    error: `sync disabled (${what})`,
    retryable: false,
  });

  return {
    mode: 'disabled',

    upsertConversation: async (_req: ChatSyncUpsertRequest) => disabled<ChatSyncUpsertResponse>('upsertConversation'),
    deleteConversation: async (_req: ChatSyncDeleteRequest) => disabled<ChatSyncDeleteResponse>('deleteConversation'),

    listConversations: async () => disabled<ChatSyncListConversationsResponse>('listConversations'),
    getConversation: async (_conversationId: DConversationId) => disabled<ChatSyncGetConversationResponse>('getConversation'),
  };
}