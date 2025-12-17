import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import { useChatSyncStore } from '~/common/sync/store-chat-sync';
import type { SyncConversation } from '~/common/sync/chatSyncWatcher';
import type { ChatSyncTransport } from './chatSyncTransport';

export interface ChatSyncUploaderOptions {
  transport: ChatSyncTransport;
  debug?: boolean;
}

/**
 * Queue + revision-aware uploader.
 * - It is "fully ready" to upload (computes baseRevision, tracks dirty ops, handles in-flight),
 *   but with a NOOP transport it won't actually send.
 */
export function createChatSyncUploader(options: ChatSyncUploaderOptions) {
  const { transport, debug = false } = options;

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
          // We know something is dirty, but we don't have the data blob.
          // This can happen after refresh; later we'll resolve by pulling from local store.
          // For now we just keep it dirty.
          useChatSyncStore.getState().setError(conversationId, 'missing upsert payload');
          return;
        }

        const result = await transport.upsertConversation({
          conversationId,
          baseRevision,
          data: payload,
        });

        if (!result.ok) {
          useChatSyncStore.getState().setError(conversationId, result.error);
          return;
        }

        // ACK (future server will supply revision)
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

    log(`[sync] queued upsert id=${conversationId} baseRevision=${getBaseRevision(conversationId)}`);

    // attempt to flush (no-op if transport disabled)
    void tryFlush(conversationId);
  }

  function queueDelete(conversationId: DConversationId) {
    // delete wins over any queued upsert payload
    pendingUpsertPayloadById.delete(conversationId);
    useChatSyncStore.getState().markDirty(conversationId, 'delete');

    log(`[sync] queued delete id=${conversationId} baseRevision=${getBaseRevision(conversationId)}`);

    void tryFlush(conversationId);
  }

  return {
    queueUpsert,
    queueDelete,

    // exposed for future UI/actions (e.g., "retry now")
    tryFlush,
  };
}