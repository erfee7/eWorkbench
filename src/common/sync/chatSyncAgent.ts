// src/common/sync/chatSyncAgent.ts

import { startChatSyncWatcher } from '~/common/sync/chatSyncWatcher';
import { createChatSyncUploader } from '~/common/sync/chatSyncUploader';
import { createChatSyncTransportNoop } from '~/common/sync/chatSyncTransport.noop';
import { createChatSyncTransportHttp } from '~/common/sync/chatSyncTransport.http';
import { createChatSyncTransportSwitchable } from '~/common/sync/chatSyncTransport.switchable';

import { createChatSyncConflictResolver } from '~/common/sync/chatSyncConflictResolver';

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

type SyncConversationChangedEvent = {
  type: 'conversation_changed';
  conversationId: DConversationId;
  revision: number;
  deleted: boolean;
  updatedAt?: number;
};

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

  const { debug = false, traceSkips = false } = options;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

  // ---- Dedicated HTTP transport (reads + later writes once enabled) ----
  // We keep a single instance so:
  // - initial pull uses it
  // - SSE-triggered pulls use it
  // - uploader can switch to it (enabling writes)
  const httpTransport = createChatSyncTransportHttp();

  // ---- Switchable transport (starts disabled, later switches to HTTP) ----
  const { transport, switchTo } = createChatSyncTransportSwitchable(createChatSyncTransportNoop());

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

  // ---- Conflict resolver (policy) ----
  // We declare this before creating the uploader so we can wire the callback safely.
  const conflictResolver = createChatSyncConflictResolver({
    transport,
    withConversationMuted,
    inflateConversationFromSync,
    queueUpsert: (c) => uploader.queueUpsert(c), // uses uploader declared below (safe closure)
    debug,
  });

  // ---- Uploader (now delegates 409 to resolver) ----
  const uploader = createChatSyncUploader({
    transport,
    debug,
    onConflict: (event) => conflictResolver.handleConflict(event),
  });

  let stopWatcher: (() => void) | null = null;
  let unsubscribeFromHydration: (() => void) | null = null;

  // ---- SSE realtime channel ----
  let stopRealtime: (() => void) | null = null;

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

  function shouldSkipRemoteApply(conversationId: DConversationId, expectedRevision: number): boolean {
    const syncState = useChatSyncStore.getState();

    // If local is dirty, do not overwrite; conflicts must be resolved via 409 workflow.
    if (syncState.dirtyOpById[conversationId]) return true;

    // If we already know a same/newer revision, skip redundant fetch/apply.
    const known = syncState.remoteRevisionById[conversationId];
    if (typeof known === 'number' && known >= expectedRevision) return true;

    return false;
  }

  async function applyRemoteDelete(conversationId: DConversationId, revision: number) {
    if (stopped) return;
    if (shouldSkipRemoteApply(conversationId, revision)) return;

    await withConversationMuted(conversationId, async () => {
      const existsLocally = !!useChatStore.getState().conversations.find(c => c.id === conversationId);
      if (existsLocally) {
        useChatStore.getState().deleteConversations([conversationId]);
      }
    });

    useChatSyncStore.getState().setRemoteRevision(conversationId, revision);
  }

  async function applyRemoteUpsertByGet(conversationId: DConversationId, expectedRevision: number) {
    if (stopped) return;
    if (shouldSkipRemoteApply(conversationId, expectedRevision)) return;

    // We expect the GET to reflect the event revision (single DB, single instance),
    // but we retry briefly to avoid "event arrived before read saw commit" edge cases.
    for (let attempt = 0; attempt < 2; attempt++) {
      const getRes = await httpTransport.getConversation(conversationId);
      if (!getRes.ok) {
        log(`[sync] realtime: GET failed id=${conversationId}: ${getRes.error}`);
        return;
      }

      const remote = getRes.value;

      // Server may say deleted even if we thought it was an upsert event.
      if (remote.deleted || !remote.data) {
        await applyRemoteDelete(conversationId, remote.revision);
        return;
      }

      if (remote.revision < expectedRevision && attempt === 0) {
        // Small delay and retry once.
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      }

      await withConversationMuted(conversationId, async () => {
        useChatStore.getState().importConversation(inflateConversationFromSync(remote.data!), false);
      });

      useChatSyncStore.getState().setRemoteRevision(conversationId, remote.revision);
      return;
    }

    // If we get here, the server kept returning an older revision.
    // Do nothing; a later event/reconnect will repair it.
    log(`[sync] realtime: GET returned older revision than expected id=${conversationId} expected=${expectedRevision}`);
  }

  function startRealtimeAfterInit() {
    if (stopRealtime || stopped) return;

    // Per-conversation coalescing: keep only the latest revision per id.
    const pendingById = new Map<DConversationId, { revision: number; deleted: boolean }>();

    let drainInFlight = false;
    let drainAgain = false;

    function queueEvent(e: SyncConversationChangedEvent) {
      const prev = pendingById.get(e.conversationId);
      if (!prev || e.revision > prev.revision) {
        pendingById.set(e.conversationId, { revision: e.revision, deleted: e.deleted });
      }

      if (drainInFlight) {
        drainAgain = true;
        return;
      }

      void drainQueue();
    }

    async function drainQueue() {
      if (drainInFlight) return;

      drainInFlight = true;
      try {
        while (!stopped && pendingById.size) {
          const next = pendingById.entries().next().value as [DConversationId, { revision: number; deleted: boolean }];
          const [conversationId, meta] = next;
          pendingById.delete(conversationId);

          if (meta.deleted) {
            await applyRemoteDelete(conversationId, meta.revision);
          } else {
            await applyRemoteUpsertByGet(conversationId, meta.revision);
          }
        }
      } finally {
        drainInFlight = false;

        if (!stopped && drainAgain) {
          drainAgain = false;
          void drainQueue();
        }
      }
    }

    // Manual reconnect loop (more predictable than relying on EventSource auto-retry).
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;

    function cleanupConnection() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;

      if (es) es.close();
      es = null;
    }

    function scheduleReconnect() {
      if (stopped) return;

      cleanupConnection();

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoffMs);

      backoffMs = Math.min(30_000, backoffMs * 2);
    }

    function connect() {
      if (stopped) return;

      try {
        // Same-origin; cookies included automatically. withCredentials=true for future proxy/cors setups.
        es = new EventSource('/api/sync/events', { withCredentials: true });
      } catch (err) {
        log('[sync] realtime: failed to create EventSource', err);
        scheduleReconnect();
        return;
      }

      es.addEventListener('open', () => {
        backoffMs = 1000;
        log('[sync] realtime: connected');
      });

      es.addEventListener('conversation_changed', (evt: Event) => {
        const msgEvt = evt as MessageEvent;

        let data: any = null;
        try {
          data = JSON.parse(msgEvt.data);
        } catch {
          return;
        }

        // Validate minimally; keep this resilient.
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'conversation_changed') return;
        if (typeof data.conversationId !== 'string') return;
        if (typeof data.revision !== 'number' || !Number.isFinite(data.revision) || data.revision < 0) return;
        if (typeof data.deleted !== 'boolean') return;

        queueEvent({
          type: 'conversation_changed',
          conversationId: data.conversationId,
          revision: data.revision,
          deleted: data.deleted,
          updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
        });
      });

      es.addEventListener('error', () => {
        // Errors include server closing (TTL) and network issues.
        // We reconnect with backoff to avoid hammering when unauthorized/offline.
        log('[sync] realtime: disconnected; scheduling reconnect');
        scheduleReconnect();
      });
    }

    connect();

    stopRealtime = () => {
      cleanupConnection();
      pendingById.clear();
      stopRealtime = null;
    };
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
    // Snapshot what we previously believed the remote revisions were.
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

    /**
     * IMPORTANT SEMANTICS (conflict correctness):
     *
     * `remoteRevisionById[id]` is the revision that the client believes its LOCAL base corresponds to.
     *
     * If a conversation is locally dirty, we MUST NOT update `remoteRevisionById` from the server list here,
     * otherwise we could accidentally "fast-forward" baseRevision and overwrite remote changes without a 409.
     *
     * By not updating it, a changed remote will naturally trigger a 409 during upload,
     * and we will enter the conflict resolver workflow (copy local + pull remote).
     */
    const dirtyAtStartup = { ...useChatSyncStore.getState().dirtyOpById };

    // 1) Record latest remote revisions (knowledge, not a mutation of chats)
    for (const item of items) {
      if (dirtyAtStartup[item.conversationId]) {
        if (traceSkips) console.log(`[sync] initial pull: skip revision update (local dirty) id=${item.conversationId}`);
        continue;
      }
      useChatSyncStore.getState().setRemoteRevision(item.conversationId, item.revision);
    }

    // 2) Apply remote state locally (tombstones + missing/outdated pulls)
    for (const item of items) {
      if (stopped) return;

      const conversationId = item.conversationId;

      // If local has pending intent for this conversation, do NOT overwrite it with remote here.
      // Conflicts will be resolved by 409 + resolver later.
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

    // 3) Enable uploads
    switchTo(httpTransport);
    log('[sync] transport switched to HTTP; uploads enabled');

    // 4) Rebuild dirty upsert payloads and queue them
    reconcileDirtyUpsertsAfterHydration();

    // 5) Flush remaining dirty ops
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

      // Run initial pull first, then start realtime SSE notifications.
      void (async () => {
        await initialPullAndApplyRemote();

        if (stopped) return;
        startRealtimeAfterInit();
      })();
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

    if (stopRealtime) stopRealtime();
    stopRealtime = null;

    if (stopWatcher) stopWatcher();
    stopWatcher = null;

    muteCountById.clear();

    singletonStopAgent = null;
  };

  return singletonStopAgent;
}