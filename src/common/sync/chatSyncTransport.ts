// src/common/sync/chatSyncTransport.ts

import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type { SyncConversation } from '~/common/sync/chatSyncCodec';

export type ChatSyncResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number; retryable?: boolean };

export interface ChatSyncUpsertRequest {
  conversationId: DConversationId;
  baseRevision: number | null;
  data: SyncConversation;
}

export interface ChatSyncUpsertResponse {
  conversationId: DConversationId;
  revision: number;
}

export interface ChatSyncDeleteRequest {
  conversationId: DConversationId;
  baseRevision: number | null;
}

export interface ChatSyncDeleteResponse {
  conversationId: DConversationId;
  revision: number;
}

export interface ChatSyncTransport {
  /**
   * 'disabled' means: do not attempt network calls.
   * We'll keep queueing dirty ops so we can flush later when enabled.
   */
  mode: 'disabled' | 'http';

  upsertConversation(req: ChatSyncUpsertRequest): Promise<ChatSyncResult<ChatSyncUpsertResponse>>;
  deleteConversation(req: ChatSyncDeleteRequest): Promise<ChatSyncResult<ChatSyncDeleteResponse>>;
}