// src/server/sync/syncNotifier.ts

/**
 * Very small in-memory pubsub for "notify other clients to pull".
 *
 * NOTE:
 * - Single-instance Docker deployment => in-memory is sufficient.
 * - If/when we scale to multi-instance, this module becomes the seam to swap to Redis/PG NOTIFY/etc.
 */

export type SyncRealtimeEvent =
  | {
    type: 'conversation_changed';
    conversationId: string;
    revision: number;
    deleted: boolean;
    updatedAt: number; // unix ms; diagnostic only
  };

type Subscriber = (event: SyncRealtimeEvent) => void;

type Registry = Map<string /* userId */, Set<Subscriber>>;

const GLOBAL_KEY = '__ew_sync_realtime_notifier_v1__';

function getRegistry(): Registry {
  const g = globalThis as any;

  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map();
  }

  return g[GLOBAL_KEY] as Registry;
}

export function subscribeSyncRealtime(userId: string, fn: Subscriber): () => void {
  const reg = getRegistry();

  let set = reg.get(userId);
  if (!set) {
    set = new Set();
    reg.set(userId, set);
  }

  set.add(fn);

  return () => {
    const current = reg.get(userId);
    if (!current) return;

    current.delete(fn);

    // Keep the registry small.
    if (current.size === 0) reg.delete(userId);
  };
}

export function publishSyncRealtime(userId: string, event: SyncRealtimeEvent): void {
  const reg = getRegistry();
  const set = reg.get(userId);
  if (!set || set.size === 0) return;

  // Defensive: one subscriber must not break the others.
  for (const fn of set) {
    try {
      fn(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sync:notifier] subscriber threw', err);
    }
  }
}

export function publishConversationChanged(userId: string, conversationId: string, revision: number, deleted: boolean): void {
  publishSyncRealtime(userId, {
    type: 'conversation_changed',
    conversationId,
    revision,
    deleted,
    updatedAt: Date.now(),
  });
}