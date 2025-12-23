// src/common/sync/chatSyncUploader.ts

import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import { useChatSyncStore } from '~/common/sync/store-chat-sync';
import type { SyncConversation } from '~/common/sync/chatSyncCodec';
import type { ChatSyncTransport } from './chatSyncTransport';
import type { ChatSyncConflictEvent } from '~/common/sync/chatSyncConflictResolver';

export interface ChatSyncUploaderOptions {
  transport: ChatSyncTransport;
  debug?: boolean;

  /**
   * Called when the server returns a 409 conflict.
   * The resolver is responsible for:
   * - fetching remote state
   * - updating local store under mute
   * - updating sync metadata (remoteRevisionById/dirtyOpById)
   */
  onConflict?: (event: ChatSyncConflictEvent) => Promise<void> | void;
}

/**
 * Queue + revision-aware uploader.
 */
export function createChatSyncUploader(options: ChatSyncUploaderOptions) {
  const { transport, debug = false, onConflict } = options;

  const pendingUpsertPayloadById = new Map<DConversationId, SyncConversation>();

  // inFlight prevents overlapping requests for the same conversation
  const inFlight = new Set<DConversationId>();

  // avoid spamming "disabled" logs
  let warnedDisabled = false;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

  function getBaseRevision(conversationId: DConversationId): number | null {
    const rev = useChatSyncStore.getState().remoteRevisionById[conversationId];
    return typeof rev === 'number' ? rev : null;
  }

  async function tryFlush(conversationId: DConversationId): Promise<void> {
    if (inFlight.has(conversationId)) return;

    const syncState = useChatSyncStore.getState();
    const dirtyOp = syncState.dirtyOpById[conversationId];
    if (!dirtyOp) return;

    if (transport.mode === 'disabled') {
      if (!warnedDisabled) {
        warnedDisabled = true;
        log('[sync] uploader: transport disabled; queueing changes locally (no network calls)');
      }
      return;
    }

    // Capture what we are attempting to send now.
    // If it changes while we are in-flight, we'll flush again in finally.
    const opAtStart = dirtyOp;

    inFlight.add(conversationId);
    const attemptAt = Date.now();
    useChatSyncStore.getState().setAttempt(conversationId, attemptAt);
    useChatSyncStore.getState().setError(conversationId, undefined);

    try {
      const baseRevision = getBaseRevision(conversationId);

      if (dirtyOp === 'upsert') {
        const payload = pendingUpsertPayloadById.get(conversationId);
        if (!payload) {
          // Dirty but no payload blob: can happen after refresh; agent will reconcile later.
          useChatSyncStore.getState().setError(conversationId, 'missing upsert payload');
          return;
        }

        const result = await transport.upsertConversation({
          conversationId,
          baseRevision,
          data: payload,
        });

        if (!result.ok) {
          // 409 conflict: delegate to resolver (agent-owned policy).
          if (result.status === 409 && result.conflict && onConflict) {
            await onConflict({
              op: 'upsert',
              conversationId,
              baseRevision,
              conflict: result.conflict,
              attemptedData: payload,
            });
            return;
          }

          useChatSyncStore.getState().setError(conversationId, result.error);
          return;
        }

        // ACK
        useChatSyncStore.getState().setRemoteRevision(conversationId, result.value.revision);
        useChatSyncStore.getState().clearDirty(conversationId);
        pendingUpsertPayloadById.delete(conversationId);
        return;
      }

      if (dirtyOp === 'delete') {
        const result = await transport.deleteConversation({
          conversationId,
          baseRevision,
        });

        if (!result.ok) {
          // 409 conflict: delegate to resolver (agent-owned policy).
          if (result.status === 409 && result.conflict && onConflict) {
            await onConflict({
              op: 'delete',
              conversationId,
              baseRevision,
              conflict: result.conflict,
            });
            return;
          }

          useChatSyncStore.getState().setError(conversationId, result.error);
          return;
        }

        // ACK delete revision (tombstone)
        useChatSyncStore.getState().setRemoteRevision(conversationId, result.value.revision);
        useChatSyncStore.getState().clearDirty(conversationId);
        pendingUpsertPayloadById.delete(conversationId);
        return;
      }

    } finally {
      inFlight.delete(conversationId);

      // Only retry immediately if the desired op changed while we were sending.
      const opNow = useChatSyncStore.getState().dirtyOpById[conversationId];
      if (opNow && opNow !== opAtStart) {
        void tryFlush(conversationId);
      }
    }
  }

  function queueUpsert(conversation: SyncConversation) {
    const conversationId = conversation.id;
    pendingUpsertPayloadById.set(conversationId, conversation);
    useChatSyncStore.getState().markDirty(conversationId, 'upsert');
    useChatSyncStore.getState().setError(conversationId, undefined);

    log(`[sync] queued upsert id=${conversationId} baseRevision=${getBaseRevision(conversationId)}`);

    // attempt to flush (no-op if transport disabled)
    void tryFlush(conversationId);
  }

  function queueDelete(conversationId: DConversationId) {
    // delete wins over any queued upsert payload
    pendingUpsertPayloadById.delete(conversationId);
    useChatSyncStore.getState().markDirty(conversationId, 'delete');
    useChatSyncStore.getState().setError(conversationId, undefined);

    log(`[sync] queued delete id=${conversationId} baseRevision=${getBaseRevision(conversationId)}`);

    void tryFlush(conversationId);
  }

  return {
    queueUpsert,
    queueDelete,
    tryFlush,
  };
}