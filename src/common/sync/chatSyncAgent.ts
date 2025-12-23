// src/common/sync/chatSyncAgent.ts

import { startChatSyncWatcher } from '~/common/sync/chatSyncWatcher';
import { createChatSyncUploader } from '~/common/sync/chatSyncUploader';
import { createChatSyncTransportNoop } from '~/common/sync/chatSyncTransport.noop';
import { createChatSyncTransportHttp } from '~/common/sync/chatSyncTransport.http';
import { createChatSyncTransportSwitchable } from '~/common/sync/chatSyncTransport.switchable';

import { useChatStore } from '~/common/stores/chat/store-chats';
import { useChatSyncStore } from '~/common/sync/store-chat-sync';

import type { DConversation, DConversationId } from '~/common/stores/chat/chat.conversation';
import type { DMessage } from '~/common/stores/chat/chat.message';

import { isConversationSyncEligible, sanitizeConversationForSync } from '~/common/sync/chatSyncCodec';
import type { SyncConversation } from '~/common/sync/chatSyncCodec';

let singletonStopAgent: (() => void) | null = null;

export interface ChatSyncAgentOptions {
  debug?: boolean;
  traceSkips?: boolean;
}

/**
 * Convert a SyncConversation (wire format) back into a DConversation (in-memory store format).
 *
 * IMPORTANT:
 * - SyncConversation omits tokenCount and _abortController. We re-add them.
 * - We DO NOT set _isIncognito (never synced).
 * - Token counts are local caches; importConversation() will recompute them anyway.
 */
function inflateConversationFromSync(sync: SyncConversation): DConversation {
  return {
    ...sync,

    // local-only fields required by in-memory store shape
    _abortController: null,
    tokenCount: 0,

    // messages: re-add tokenCount cache per message
    messages: (sync.messages || []).map((m): DMessage => ({
      ...m,
      tokenCount: 0,
    })),
  };
}

export function startChatSyncAgent(options: ChatSyncAgentOptions = {}): () => void {
  if (singletonStopAgent) return singletonStopAgent;

  const { debug = true, traceSkips = false } = options;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

  // ---- Switchable transport (starts disabled, later switches to HTTP) ----
  const { transport, switchTo } = createChatSyncTransportSwitchable(createChatSyncTransportNoop());
  const uploader = createChatSyncUploader({ transport, debug });

  // ---- Per-conversation mute registry (reference-counted) ----
  const muteCountById = new Map<DConversationId, number>();

  function isMuted(conversationId: DConversationId): boolean {
    return (muteCountById.get(conversationId) || 0) > 0;
  }

  async function withConversationMuted<T>(conversationId: DConversationId, fn: () => Promise<T> | T): Promise<T> {
    // Reference-counting prevents "unmute too early" bugs if we ever nest calls.
    muteCountById.set(conversationId, (muteCountById.get(conversationId) || 0) + 1);
    try {
      return await fn();
    } finally {
      const next = (muteCountById.get(conversationId) || 1) - 1;
      if (next <= 0) muteCountById.delete(conversationId);
      else muteCountById.set(conversationId, next);
    }
  }

  let stopWatcher: (() => void) | null = null;
  let unsubscribeFromHydration: (() => void) | null = null;
  let stopped = false;

  function reconcileDirtyUpsertsAfterHydration() {
    // Rebuild missing upsert payloads from hydrated chat store.
    // IMPORTANT POLICY:
    // If we cannot reconstruct the upsert payload locally, we DROP the upsert.
    // We do NOT infer deletes from missing local data.

    const syncState = useChatSyncStore.getState();
    const dirtyOpById = syncState.dirtyOpById;

    const dirtyEntries = Object.entries(dirtyOpById) as [DConversationId, 'upsert' | 'delete'][];
    if (!dirtyEntries.length) return;

    const conversations = useChatStore.getState().conversations;

    for (const [conversationId, op] of dirtyEntries) {
      if (op !== 'upsert') continue;

      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        // Cannot rebuild payload -> drop upsert (non-destructive to remote)
        useChatSyncStore.getState().clearDirty(conversationId);
        useChatSyncStore.getState().setError(conversationId, undefined);
        log(`[sync] reconcile: dropped dirty upsert (conversation missing locally) id=${conversationId}`);
        continue;
      }

      if (!isConversationSyncEligible(conversation)) {
        // Still cannot produce a valid payload -> drop upsert (non-destructive to remote)
        useChatSyncStore.getState().clearDirty(conversationId);
        useChatSyncStore.getState().setError(conversationId, undefined);
        log(`[sync] reconcile: dropped dirty upsert (conversation not eligible) id=${conversationId}`);
        continue;
      }

      const payload = sanitizeConversationForSync(conversation);
      uploader.queueUpsert(payload);
      log(`[sync] reconcile: rebuilt dirty upsert payload id=${conversationId}`);
    }
  }

  function startWatcher() {
    if (stopWatcher || stopped) return;

    stopWatcher = startChatSyncWatcher({
      debug,
      traceSkips,

      // Critical: watcher remains running, but ignores remote-applied mutations
      isMuted,

      onUpsert: uploader.queueUpsert,
      onDelete: uploader.queueDelete,
    });
  }

  /**
   * Initial pull:
   * - Populate remoteRevisionById (so baseRevision is correct when we enable uploads)
   * - Import missing/outdated conversations
   * - Apply tombstones (delete locally)
   *
   * NOTE: Watcher is running during this, so we MUST wrap any local store mutations
   * with withConversationMuted(id, ...) to avoid sync feedback loops.
   */
  async function initialPullAndApplyRemote() {
    const httpTransport = createChatSyncTransportHttp();

    // Snapshot what we *previously* believed the remote revisions were.
    // We use this to detect "server changed since last time" without needing full blobs.
    const prevRemoteRevisionById = { ...useChatSyncStore.getState().remoteRevisionById };

    log('[sync] initial pull: listing remote metadata...');
    const listRes = await httpTransport.listConversations();
    if (!listRes.ok) {
      log(`[sync] initial pull: list failed: ${listRes.error}`);
      // Leave transport disabled; local ops stay queued.
      return;
    }

    const items = listRes.value.items || [];
    log(`[sync] initial pull: got ${items.length} remote items`);

    // 1) Record latest remote revisions (knowledge, not a mutation of chats)
    for (const item of items) {
      useChatSyncStore.getState().setRemoteRevision(item.conversationId, item.revision);
    }

    // 2) Apply remote state locally (tombstones + missing/outdated pulls)
    for (const item of items) {
      if (stopped) return;

      const conversationId = item.conversationId;

      // If local has pending intent for this conversation, do NOT overwrite it with remote.
      // This prevents silent data loss (conflict path will be handled later via 409 + pull).
      if (useChatSyncStore.getState().dirtyOpById[conversationId]) {
        if (traceSkips) console.log(`[sync] initial pull: skip apply (local dirty) id=${conversationId}`);
        continue;
      }

      const localConversation = useChatStore.getState().conversations.find(c => c.id === conversationId) || null;

      // Apply tombstone
      if (item.deleted) {
        if (!localConversation) continue;

        await withConversationMuted(conversationId, async () => {
          // deleteConversations always ensures at least one conversation exists (placeholder empty),
          // which is ineligible and won't sync.
          useChatStore.getState().deleteConversations([conversationId]);
        });

        log(`[sync] initial pull: applied tombstone locally id=${conversationId}`);
        continue;
      }

      // Not deleted: decide if we should pull the full blob
      const wasKnownRevision = prevRemoteRevisionById[conversationId];
      const serverRevision = item.revision;

      const shouldPull =
        !localConversation || (wasKnownRevision !== serverRevision);

      if (!shouldPull) continue;

      const getRes = await httpTransport.getConversation(conversationId);
      if (!getRes.ok) {
        log(`[sync] initial pull: get failed id=${conversationId}: ${getRes.error}`);
        continue;
      }

      // Server could still return deleted=true here; honor it.
      if (getRes.value.deleted || !getRes.value.data) {
        if (localConversation) {
          await withConversationMuted(conversationId, async () => {
            useChatStore.getState().deleteConversations([conversationId]);
          });
          log(`[sync] initial pull: server said deleted on GET -> deleted locally id=${conversationId}`);
        }
        continue;
      }

      const dConversation = inflateConversationFromSync(getRes.value.data);

      await withConversationMuted(conversationId, async () => {
        // preventClash=false because:
        // - if conversation exists locally, we want to overwrite it (not duplicate it)
        // - if it doesn't exist, we want to keep the server id (stable across devices)
        useChatStore.getState().importConversation(dConversation, false);
      });

      // Ensure our revision knowledge matches the GET response (stronger than list)
      useChatSyncStore.getState().setRemoteRevision(conversationId, getRes.value.revision);

      log(`[sync] initial pull: imported from server id=${conversationId} rev=${getRes.value.revision}`);
    }

    // 3) Enable uploads by switching transport used by uploader
    switchTo(httpTransport);
    log('[sync] transport switched to HTTP; uploads enabled');

    // 4) Rebuild any persisted dirty upserts (payloads are not persisted) and queue them
    reconcileDirtyUpsertsAfterHydration();

    // 5) Flush any remaining dirty ops (especially deletes, which have no payload to rebuild)
    const dirtyNow = useChatSyncStore.getState().dirtyOpById;
    for (const conversationId of Object.keys(dirtyNow) as DConversationId[]) {
      void uploader.tryFlush(conversationId);
    }
  }

  function startAfterHydration() {
    const persistApi = (useChatStore as any).persist as {
      hasHydrated?: () => boolean;
      onFinishHydration?: (cb: () => void) => () => void;
    };

    const onHydrated = () => {
      if (stopped) return;

      // Start watcher as soon as we're hydrated.
      // Remote pulls will be applied under per-conversation mute to avoid loops.
      startWatcher();

      // Then do initial pull and enable HTTP transport.
      void initialPullAndApplyRemote();
    };

    if (persistApi?.hasHydrated?.()) {
      onHydrated();
      return;
    }

    log('[sync] agent: waiting for chat store hydration...');
    unsubscribeFromHydration = persistApi?.onFinishHydration?.(onHydrated) ?? null;
  }

  startAfterHydration();

  singletonStopAgent = () => {
    stopped = true;

    if (unsubscribeFromHydration) unsubscribeFromHydration();
    unsubscribeFromHydration = null;

    if (stopWatcher) stopWatcher();
    stopWatcher = null;

    muteCountById.clear();

    singletonStopAgent = null;
  };

  return singletonStopAgent;
}