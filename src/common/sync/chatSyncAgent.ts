// src/common/sync/chatSyncAgent.ts

import { startChatSyncWatcher } from '~/common/sync/chatSyncWatcher';
import { createChatSyncUploader } from '~/common/sync/chatSyncUploader';
import { createChatSyncTransportNoop } from '~/common/sync/chatSyncTransport.noop';
import { useChatStore } from '~/common/stores/chat/store-chats';
import { useChatSyncStore } from '~/common/sync/store-chat-sync';
import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import { isConversationSyncEligible, sanitizeConversationForSync } from '~/common/sync/chatSyncCodec';


let singletonStopAgent: (() => void) | null = null;

export interface ChatSyncAgentOptions {
  debug?: boolean;
  traceSkips?: boolean;
}

/**
 * One-stop sync bootstrap:
 * watcher -> uploader -> transport
 */
export function startChatSyncAgent(options: ChatSyncAgentOptions = {}): () => void {
  if (singletonStopAgent) return singletonStopAgent;

  const { debug = true, traceSkips = false } = options;

  const transport = createChatSyncTransportNoop();
  const uploader = createChatSyncUploader({ transport, debug });

  let stopWatcher: (() => void) | null = null;
  let unsubscribeFromHydration: (() => void) | null = null;
  let stopped = false;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

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
      onUpsert: uploader.queueUpsert,
      onDelete: uploader.queueDelete,
    });
  }

  function startAfterHydration() {
    const persistApi = (useChatStore as any).persist as {
      hasHydrated?: () => boolean;
      onFinishHydration?: (cb: () => void) => () => void;
    };

    const onHydrated = () => {
      if (stopped) return;
      reconcileDirtyUpsertsAfterHydration();
      startWatcher();
    };

    if (persistApi?.hasHydrated?.()) {
      onHydrated();
      return;
    }

    log('[sync] agent: waiting for chat store hydration (for reconciliation)...');
    unsubscribeFromHydration = persistApi?.onFinishHydration?.(onHydrated) ?? null;
  }

  startAfterHydration();

  singletonStopAgent = () => {
    stopped = true;

    if (unsubscribeFromHydration) unsubscribeFromHydration();
    unsubscribeFromHydration = null;

    if (stopWatcher) stopWatcher();
    stopWatcher = null;

    singletonStopAgent = null;
  };

  return singletonStopAgent;
}