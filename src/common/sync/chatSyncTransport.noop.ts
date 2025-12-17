import type { ChatSyncDeleteRequest, ChatSyncDeleteResponse, ChatSyncResult, ChatSyncTransport, ChatSyncUpsertRequest, ChatSyncUpsertResponse } from './chatSyncTransport';

export function createChatSyncTransportNoop(): ChatSyncTransport {
  return {
    mode: 'disabled',

    async upsertConversation(_req: ChatSyncUpsertRequest): Promise<ChatSyncResult<ChatSyncUpsertResponse>> {
      return { ok: false, error: 'sync transport disabled', retryable: true };
    },

    async deleteConversation(_req: ChatSyncDeleteRequest): Promise<ChatSyncResult<ChatSyncDeleteResponse>> {
      return { ok: false, error: 'sync transport disabled', retryable: true };
    },
  };
}