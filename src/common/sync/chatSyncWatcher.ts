// src/common/sync/chatSyncWatcher.ts

import { useChatStore } from '~/common/stores/chat/store-chats';
import type { DConversation, DConversationId } from '~/common/stores/chat/chat.conversation';
import type { SyncConversation } from '~/common/sync/chatSyncCodec';
import { isConversationSyncEligible, sanitizeConversationForSync } from '~/common/sync/chatSyncCodec';

/**
 * Re-export types for compatibility (other modules may import from watcher).
*/
export type { SyncMessage, SyncConversation } from '~/common/sync/chatSyncCodec';

export interface ChatSyncWatcherOptions {
  /**
   * Debounce time per-conversation.
   * If a conversation is changing rapidly (streaming), we wait this long after the last change
   * before triggering an upload.
   */
  debounceMs?: number;

  /**
   * Maximum time we allow postponing an upload during continuous changes.
   * This ensures that long streaming responses still upload periodically.
   */
  maxWaitMs?: number;

  /**
   * Called when a conversation should be uploaded (upsert).
   * For now we default to console logging.
   */
  onUpsert?: (conversation: SyncConversation) => void | Promise<void>;

  /**
   * Called when a conversation was deleted locally and should be deleted remotely.
   * For now we default to console logging.
   */
  onDelete?: (conversationId: DConversationId) => void | Promise<void>;

  /**
   * If true for an id, the watcher will ignore changes for that conversation.
   * This is how we apply remote pulls (startup pull and later SSE pulls) without creating an "upload loop".
   */
  isMuted?: (conversationId: DConversationId) => boolean;

  /**
   * Debug logging toggle.
   */
  debug?: boolean;
  traceSkips?: boolean;
}

type TimerHandle = ReturnType<typeof setTimeout>;

type PendingIntent = {
  kind: 'upsert' | 'delete';
  timer: TimerHandle | null;
  firstQueuedAt: number;
};


/**
 * Start a single global watcher.
 * Safe to call multiple times: it will only start once and return the same stop function.
 */
export function startChatSyncWatcher(options: ChatSyncWatcherOptions = {}): () => void {
  const {
    debounceMs = 900,
    maxWaitMs = 5000,
    debug = false,
    traceSkips = false,
    onUpsert = async (c: SyncConversation) => {
      // // Default behavior for prototype: log to console.
      // console.log(
      //   `[sync] would upsert conversation id=${c.id} messages=${c.messages?.length ?? 0} updated=${c.updated}`
      // );
    },
    onDelete = async (conversationId: DConversationId) => {
      // // Default behavior for prototype: log to console.
      // console.log(
      //   `[sync] would delete conversation id=${conversationId}`
      // );
    },
    isMuted = () => false,
  } = options;

  // Track the latest conversation object we have seen for each id.
  // When the debounce timer fires, we upload THIS latest version.
  const latestById = new Map<DConversationId, DConversation>();

  // Track pending intent per conversation id.
  // If a delete and an upsert happen close together, the last one wins.
  const pending = new Map<DConversationId, PendingIntent>();

  // Keep unsubscribe functions so we can stop cleanly.
  let unsubscribeFromStore: (() => void) | null = null;
  let unsubscribeFromHydration: (() => void) | null = null;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

  function trace(...args: any[]) {
    if (traceSkips) console.log(...args);
  }

  async function flushIntent(conversationId: DConversationId) {
    const entry = pending.get(conversationId);
    if (!entry) return;

    // Stop timer and remove pending entry
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(conversationId);

    if (entry.kind === 'delete') {
      await onDelete(conversationId);
      return;
    }

    let conversation = latestById.get(conversationId);
    // Fallback: if our cached pointer is missing, try to read from the store now.
    // This makes flush resilient to cache clears / dev hot reload / timing edges.
    if (!conversation) {
      conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
    }

if (!conversation) {
  log(`[sync] skip upsert (conversation not found) id=${conversationId}`);
  return;
}

    if (!isConversationSyncEligible(conversation)) {
      trace(`[sync] skip upsert (not eligible) id=${conversationId}`);
      return;
    }

    const payload = sanitizeConversationForSync(conversation);
    await onUpsert(payload);
  }

  function queueIntent(conversationId: DConversationId, kind: PendingIntent['kind']) {
    const now = Date.now();
    const existing = pending.get(conversationId);

    // If this is a new intent, or intent kind changes (upsert<->delete),
    // reset max-wait tracking and reschedule.
    if (!existing || existing.kind !== kind) {
      if (existing?.timer) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        void flushIntent(conversationId);
      }, debounceMs);

      pending.set(conversationId, { kind, timer, firstQueuedAt: now });
      return;
    }

    // If already pending, reset the timer (debounce behavior),
    // but enforce maxWaitMs so it cannot be postponed forever.
    if (existing.timer) clearTimeout(existing.timer);

    const elapsed = now - existing.firstQueuedAt;
    const remainingMaxWait = Math.max(0, maxWaitMs - elapsed);

    // If maxWait already exceeded, flush immediately.
    if (remainingMaxWait === 0) {
      void flushIntent(conversationId);
      return;
    }

    // Otherwise schedule for min(debounceMs, remainingMaxWait)
    const delay = Math.min(debounceMs, remainingMaxWait);
    existing.timer = setTimeout(() => {
      void flushIntent(conversationId);
    }, delay);

    pending.set(conversationId, existing);
  }

  function queueUpsert(conversation: DConversation) {
    if (isMuted(conversation.id)) {
      trace(`[sync] skip upsert (muted) id=${conversation.id}`);
      return;
    }
    if (!isConversationSyncEligible(conversation)) return;
    latestById.set(conversation.id, conversation);
    queueIntent(conversation.id, 'upsert');
  }

  function queueDelete(conversationId: DConversationId) {
    if (isMuted(conversationId)) {
      trace(`[sync] skip delete (muted) id=${conversationId}`);
      return;
    }
    queueIntent(conversationId, 'delete');
  }

  function handleStoreChange(nextState: any, prevState: any) {
    const nextConversations: DConversation[] = nextState.conversations;
    const prevConversations: DConversation[] = prevState.conversations;

    // Build maps: id -> conversationObject
    const nextById = new Map<DConversationId, DConversation>(nextConversations.map(c => [c.id, c]));
    const prevById = new Map<DConversationId, DConversation>(prevConversations.map(c => [c.id, c]));

    // Detect deletions (present in prev, missing in next)
    for (const [prevId, prevConv] of prevById.entries()) {
      if (nextById.has(prevId)) continue;

      if (isMuted(prevId)) {
        trace(`[sync] skip delete (muted) id=${prevId}`);
        continue;
      }

      // Do not sync deletes for conversations that were never sync-eligible
      if (!isConversationSyncEligible(prevConv)) {
        trace(`[sync] skip delete (not eligible) id=${prevId}`);
        continue;
      }

      queueDelete(prevId);
    }

    // Detect additions/updates
    for (const [id, nextConv] of nextById.entries()) {
      if (isMuted(id)) {
        trace(`[sync] skip change (muted) id=${id}`);
        continue;
      }

      const prevConv = prevById.get(id);

      // New conversation
      if (!prevConv) {
        if (isConversationSyncEligible(nextConv)) {
          log(`[sync] detected new conversation id=${id}`);
          queueUpsert(nextConv);
        } else {
          trace(`[sync] skip new conversation (placeholder/incognito) id=${id}`);
        }
        continue;
      }

      // Changed conversation (object reference changed)
      if (prevConv !== nextConv) {
        const prevEligible = isConversationSyncEligible(prevConv);
        const nextEligible = isConversationSyncEligible(nextConv);

        // If it used to be sync-eligible but became a placeholder empty,
        // treat that as a remote delete to avoid other devices keeping stale history.
        if (prevEligible && !nextEligible) {
          log(`[sync] conversation became placeholder empty -> delete id=${id}`);
          queueDelete(id);
          continue;
        }

        if (nextEligible) {
          queueUpsert(nextConv);
        } else {
          // Not eligible now and wasn't eligible before: ignore.
          // Example: default placeholder empties churn.
          trace(`[sync] skip update (still not eligible) id=${id}`);
        }
      }
    }
  }

  function actuallyStart() {
    if (unsubscribeFromStore) return;

    log('[sync] chat watcher starting (after hydration)');

    unsubscribeFromStore = useChatStore.subscribe((state, prevState) => {
      // Zustand calls with (state, prevState) on every set().
      // We only care about conversation-level diffs.
      handleStoreChange(state, prevState);
    });
  }

  function startAfterHydration() {
    // Zustand persist attaches helpers at runtime.
    // TS may not know about them, so we access via `as any`.
    const persistApi = (useChatStore as any).persist as {
      hasHydrated?: () => boolean;
      onFinishHydration?: (cb: () => void) => () => void;
    };

    if (persistApi?.hasHydrated?.()) {
      actuallyStart();
      return;
    }

    log('[sync] waiting for chat store hydration...');

    // onFinishHydration runs once when persist rehydration completes
    unsubscribeFromHydration = persistApi?.onFinishHydration?.(() => {
      actuallyStart();
    }) ?? null;
  }

  startAfterHydration();

  const stop = () => {
    log('[sync] chat watcher stopping');

    if (unsubscribeFromHydration) unsubscribeFromHydration();
    unsubscribeFromHydration = null;

    if (unsubscribeFromStore) unsubscribeFromStore();
    unsubscribeFromStore = null;

    // Clear any pending timers
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    pending.clear();
    latestById.clear();
  };

  return stop;
}