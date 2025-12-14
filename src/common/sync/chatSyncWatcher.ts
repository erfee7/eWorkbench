import { useChatStore } from '~/common/stores/chat/store-chats';
import type { DConversation, DConversationId } from '~/common/stores/chat/chat.conversation';

/**
 * This is the "sanitized" conversation shape we will sync:
 * we remove transient / local-only fields.
 */
export type SyncConversation = Omit<DConversation, '_abortController' | '_isIncognito'>;

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
   * Debug logging toggle.
   */
  debug?: boolean;
}

type TimerHandle = ReturnType<typeof setTimeout>;

type PendingEntry = {
  timer: TimerHandle | null;
  firstQueuedAt: number;
};

let singletonStop: (() => void) | null = null;

/**
 * Start a single global watcher.
 * Safe to call multiple times: it will only start once and return the same stop function.
 */
export function startChatSyncWatcher(options: ChatSyncWatcherOptions = {}): () => void {
  if (singletonStop) return singletonStop;

  const {
    debounceMs = 900,
    maxWaitMs = 5000,
    debug = true,
    onUpsert = async (c: SyncConversation) => {
      // Default behavior for prototype: log to console.
      console.log(
        `[sync] would upsert conversation id=${c.id} messages=${c.messages?.length ?? 0} updated=${c.updated}`,
      );
    },
    onDelete = async (conversationId: DConversationId) => {
      console.log(`[sync] would delete conversation id=${conversationId}`);
    },
  } = options;

  // Track the latest conversation object we have seen for each id.
  // When the debounce timer fires, we upload THIS latest version.
  const latestById = new Map<DConversationId, DConversation>();

  // Track pending timers per conversation id.
  const pending = new Map<DConversationId, PendingEntry>();

  // Keep unsubscribe functions so we can stop cleanly.
  let unsubscribeFromStore: (() => void) | null = null;
  let unsubscribeFromHydration: (() => void) | null = null;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

  function shouldSyncConversation(c: DConversation, allCount: number): boolean {
    // Never sync incognito
    if (c._isIncognito) return false;

    // Optional: mimic the persist "partialize" behavior to avoid syncing lots of empties.
    const hasMeaningfulContent = !!c.messages?.length || !!c.userTitle || !!c.autoTitle;

    // If there are multiple conversations, ignore empty ones
    if (!hasMeaningfulContent && allCount > 1) return false;

    return true;
  }

  function sanitizeConversationForSync(c: DConversation): SyncConversation {
    // IMPORTANT:
    // We do NOT want to send transient fields like AbortController,
    // and we also don't want to ever sync _isIncognito.
    const { _abortController, _isIncognito, ...rest } = c;
    return rest;
  }

  async function flushUpsert(conversationId: DConversationId) {
    const entry = pending.get(conversationId);
    if (!entry) return;

    // Stop timer and remove pending entry
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(conversationId);

    const conversation = latestById.get(conversationId);
    if (!conversation) return;

    const allCount = useChatStore.getState().conversations.length;
    if (!shouldSyncConversation(conversation, allCount)) {
      log(`[sync] skip upsert (filtered) id=${conversationId}`);
      return;
    }

    const payload = sanitizeConversationForSync(conversation);
    await onUpsert(payload);
  }

  function queueUpsert(conversation: DConversation) {
    const conversationId = conversation.id;
    latestById.set(conversationId, conversation);

    const now = Date.now();
    const existing = pending.get(conversationId);

    if (!existing) {
      // First time we queue this conversation in this burst
      const timer = setTimeout(() => {
        void flushUpsert(conversationId);
      }, debounceMs);

      pending.set(conversationId, { timer, firstQueuedAt: now });
      return;
    }

    // If already pending, reset the timer (debounce behavior),
    // but enforce maxWaitMs so it cannot be postponed forever.
    if (existing.timer) clearTimeout(existing.timer);

    const elapsed = now - existing.firstQueuedAt;
    const remainingMaxWait = Math.max(0, maxWaitMs - elapsed);

    // If maxWait already exceeded, flush immediately.
    if (remainingMaxWait === 0) {
      void flushUpsert(conversationId);
      return;
    }

    // Otherwise schedule for min(debounceMs, remainingMaxWait)
    const delay = Math.min(debounceMs, remainingMaxWait);
    existing.timer = setTimeout(() => {
      void flushUpsert(conversationId);
    }, delay);

    pending.set(conversationId, existing);
  }

  function handleStoreChange(nextState: any, prevState: any) {
    const nextConversations: DConversation[] = nextState.conversations;
    const prevConversations: DConversation[] = prevState.conversations;

    // Build maps: id -> conversationObject
    const nextById = new Map<DConversationId, DConversation>(nextConversations.map(c => [c.id, c]));
    const prevById = new Map<DConversationId, DConversation>(prevConversations.map(c => [c.id, c]));

    // Detect deletions (present in prev, missing in next)
    for (const prevId of prevById.keys()) {
      if (!nextById.has(prevId)) {
        void onDelete(prevId);
      }
    }

    // Detect additions/updates
    for (const [id, nextConv] of nextById.entries()) {
      const prevConv = prevById.get(id);

      // New conversation
      if (!prevConv) {
        log(`[sync] detected new conversation id=${id}`);
        queueUpsert(nextConv);
        continue;
      }

      // Changed conversation (object reference changed)
      if (prevConv !== nextConv) {
        queueUpsert(nextConv);
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

  singletonStop = () => {
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

    singletonStop = null;
  };

  return singletonStop;
}