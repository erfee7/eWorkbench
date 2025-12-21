// src/server/sync/syncTypes.ts

export type SyncUserId = string;
export type SyncConversationId = string;

/**
 * Client <-> server contract notes:
 * - baseRevision: null means "this is newly created" (client asserts it does NOT exist remotely).
 * - revision is monotonic per (userId, conversationId), incremented on every accepted write.
 */

export interface SyncConversationMeta {
  conversationId: SyncConversationId;
  revision: number;
  deleted: boolean;
  updatedAt: string; // ISO string
}

export interface SyncListConversationsResponse {
  items: SyncConversationMeta[];
}

export interface SyncGetConversationResponse {
  conversationId: SyncConversationId;
  revision: number;
  deleted: boolean;
  data: unknown | null; // opaque blob; matches SyncConversation on the client
}

export interface SyncUpsertConversationRequest {
  baseRevision: number | null;
  data: unknown; // opaque conversation blob
}

export interface SyncUpsertConversationResponse {
  conversationId: SyncConversationId;
  revision: number;
}

export interface SyncDeleteConversationRequest {
  baseRevision: number | null;
}

export interface SyncDeleteConversationResponse {
  conversationId: SyncConversationId;
  revision: number;
}

/**
 * Returned on 409.
 * We include current revision/deleted so the client can decide whether to pull.
 */
export interface SyncConflictResponse {
  error: 'conflict';
  conversationId: SyncConversationId;
  revision: number;
  deleted: boolean;
}