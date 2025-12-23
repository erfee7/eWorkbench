// src/common/sync/chatSyncTransport.ts

import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type { SyncConversation } from '~/common/sync/chatSyncCodec';

export type ChatSyncResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number; retryable?: boolean };

/**
 * Remote metadata item (from GET /api/sync/conversations).
 * We keep this minimal and aligned with the server response.
 */
export interface ChatSyncConversationMeta {
  conversationId: DConversationId;
  revision: number;
  deleted: boolean;
  updatedAt: string; // ISO string from Postgres; treat as opaque on client
}

export interface ChatSyncListConversationsResponse {
  items: ChatSyncConversationMeta[];
}

export interface ChatSyncGetConversationResponse {
  conversationId: DConversationId;
  revision: number;
  deleted: boolean;
  data: SyncConversation | null;
}

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

/**
 * Transport abstraction.
 *
 * - mode='disabled' means: do not attempt network calls; keep local queue dirty.
 * - We include read methods now so the agent can do initial pull + later SSE "notify then pull"
 *   without duplicating endpoint/header/auth logic elsewhere.
 */
export interface ChatSyncTransport {
  mode: 'disabled' | 'http';

  // Writes (used by uploader)
  upsertConversation(req: ChatSyncUpsertRequest): Promise<ChatSyncResult<ChatSyncUpsertResponse>>;
  deleteConversation(req: ChatSyncDeleteRequest): Promise<ChatSyncResult<ChatSyncDeleteResponse>>;

  // Reads (used by agent puller and later SSE)
  listConversations(): Promise<ChatSyncResult<ChatSyncListConversationsResponse>>;
  getConversation(conversationId: DConversationId): Promise<ChatSyncResult<ChatSyncGetConversationResponse>>;
}