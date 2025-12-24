// src/common/sync/chatSyncConflictResolver.ts

import { agiUuid } from '~/common/util/idUtils';

import type { DConversation, DConversationId } from '~/common/stores/chat/chat.conversation';
import { useChatStore } from '~/common/stores/chat/store-chats';
import { useChatSyncStore } from '~/common/sync/store-chat-sync';

import type { SyncConversation } from '~/common/sync/chatSyncCodec';
import type { ChatSyncConflict, ChatSyncTransport } from '~/common/sync/chatSyncTransport';

export type ChatSyncConflictOp = 'upsert' | 'delete';

export interface ChatSyncConflictEvent {
  op: ChatSyncConflictOp;
  conversationId: DConversationId;

  /**
   * baseRevision used for the failing request (useful for debugging).
   */
  baseRevision: number | null;

  /**
   * Structured 409 response body from server.
   */
  conflict: ChatSyncConflict;

  /**
   * Only present for upsert conflicts: the exact payload we attempted to push.
   */
  attemptedData?: SyncConversation;
}

export interface ChatSyncConflictResolverOptions {
  transport: ChatSyncTransport;

  /**
   * Used to prevent watcher feedback loops while applying remote state locally.
   */
  withConversationMuted: <T>(conversationId: DConversationId, fn: () => Promise<T> | T) => Promise<T>;

  /**
   * Convert wire-format conversation (SyncConversation) into local store format (DConversation).
   * (SyncConversation omits local-only fields like tokenCount/_abortController.)
   */
  inflateConversationFromSync: (sync: SyncConversation) => DConversation;

  /**
   * Enqueue upload of the local copy created during conflict resolution.
   * (We explicitly queue, because imports happen under mute and should not trigger watcher upserts.)
   */
  queueUpsert: (conversation: SyncConversation) => void;

  debug?: boolean;
}

function makeConflictCopyPayload(local: SyncConversation, newId: DConversationId): SyncConversation {
  // We want an obvious title so user can recognize it later.
  const suffix = ' (conflict copy)';

  const next: SyncConversation = {
    ...local,
    id: newId,

    // Make it appear "new-ish" in the UI ordering.
    // This is subjective, but helps the user find the conflict copy.
    created: Date.now(),
    updated: Date.now(),
  };

  if (next.userTitle) {
    next.userTitle = `${next.userTitle}${suffix}`;
  } else if (next.autoTitle) {
    next.autoTitle = `${next.autoTitle}${suffix}`;
  } else {
    next.autoTitle = `Conflict copy`;
  }

  return next;
}

/**
 * Create a conflict resolver.
 *
 * Policy:
 * - PUT 409: fetch remote, import remote into original id, create a copy of local payload under a new id, queue upsert of that copy.
 * - DELETE 409:
 *   - if remote deleted: keep deleted locally (ensure revision knowledge is updated)
 *   - if remote not deleted: restore/import remote into original id (cancel local delete intent)
 *
 * IMPORTANT:
 * We fetch remote FIRST. If the remote GET fails, we do not create a copy yet,
 * to avoid creating duplicate conflict copies on repeated retries.
 */
export function createChatSyncConflictResolver(options: ChatSyncConflictResolverOptions) {
  const {
    transport,
    withConversationMuted,
    inflateConversationFromSync,
    queueUpsert,
    debug = false,
  } = options;

  function log(...args: any[]) {
    if (debug) console.log(...args);
  }

  async function handleUpsertConflict(event: ChatSyncConflictEvent): Promise<void> {
    const { conversationId, attemptedData } = event;

    if (!attemptedData) {
      useChatSyncStore.getState().setError(conversationId, 'conflict: missing attempted upsert payload');
      return;
    }

    // 1) Fetch remote record
    const remoteRes = await transport.getConversation(conversationId);
    if (!remoteRes.ok) {
      useChatSyncStore.getState().setError(conversationId, `conflict: failed to fetch remote: ${remoteRes.error}`);
      return;
    }

    const remote = remoteRes.value;

    // 2) Create a local copy under a new id
    const copyId = agiUuid('chat-dconversation');
    const copyPayload = makeConflictCopyPayload(attemptedData, copyId);

    await withConversationMuted(copyId, async () => {
      useChatStore.getState().importConversation(inflateConversationFromSync(copyPayload), false);
    });

    // Queue upload explicitly because the import above is muted.
    queueUpsert(copyPayload);

    // 3) Overwrite original id with remote truth (or apply tombstone)
    await withConversationMuted(conversationId, async () => {
      if (remote.deleted || !remote.data) {
        // Ensure local is deleted if server says tombstoned.
        const existsLocally = !!useChatStore.getState().conversations.find(c => c.id === conversationId);
        if (existsLocally) {
          useChatStore.getState().deleteConversations([conversationId]);
        }
      } else {
        useChatStore.getState().importConversation(inflateConversationFromSync(remote.data), false);
      }
    });

    // 4) Update revision knowledge and clear the original dirty op.
    // IMPORTANT SEMANTIC:
    // remoteRevisionById tracks the revision of what we have locally accepted as the base for this id.
    // After conflict resolution we have accepted the remote version, so we set it here.
    useChatSyncStore.getState().setRemoteRevision(conversationId, remote.revision);
    useChatSyncStore.getState().clearDirty(conversationId);
    useChatSyncStore.getState().setError(conversationId, undefined);

    console.warn('[sync] resolved PUT 409 by creating a local copy and applying remote to original', {
      conversationId,
      copyId,
      remoteRevision: remote.revision,
      remoteDeleted: remote.deleted,
    });

    log('[sync] upsert conflict handled', { conversationId, copyId });
  }

  async function handleDeleteConflict(event: ChatSyncConflictEvent): Promise<void> {
    const { conversationId } = event;

    // 1) Fetch remote record
    const remoteRes = await transport.getConversation(conversationId);
    if (!remoteRes.ok) {
      useChatSyncStore.getState().setError(conversationId, `conflict: failed to fetch remote: ${remoteRes.error}`);
      return;
    }

    const remote = remoteRes.value;

    // 2) Apply policy:
    // - if remote deleted: keep deleted locally (no further local action needed, but ensure we don't have a stray local record)
    // - else: restore remote locally (import/overwrite), cancelling local delete intent
    await withConversationMuted(conversationId, async () => {
      if (remote.deleted || !remote.data) {
        const existsLocally = !!useChatStore.getState().conversations.find(c => c.id === conversationId);
        if (existsLocally) {
          useChatStore.getState().deleteConversations([conversationId]);
        }
      } else {
        useChatStore.getState().importConversation(inflateConversationFromSync(remote.data), false);
      }
    });

    // 3) Update revision knowledge and clear delete intent.
    useChatSyncStore.getState().setRemoteRevision(conversationId, remote.revision);
    useChatSyncStore.getState().clearDirty(conversationId);
    useChatSyncStore.getState().setError(conversationId, undefined);

    console.warn('[sync] resolved DELETE 409 by applying remote truth locally', {
      conversationId,
      remoteRevision: remote.revision,
      remoteDeleted: remote.deleted,
    });

    log('[sync] delete conflict handled', { conversationId });
  }

  async function handleConflict(event: ChatSyncConflictEvent): Promise<void> {
    // Conflicts should only happen while transport is enabled.
    // Still, we guard here to avoid weird states during development/hot reload.
    if (transport.mode === 'disabled') {
      useChatSyncStore.getState().setError(event.conversationId, 'conflict: cannot resolve while transport disabled');
      return;
    }

    if (event.op === 'upsert') return handleUpsertConflict(event);
    if (event.op === 'delete') return handleDeleteConflict(event);

    useChatSyncStore.getState().setError(event.conversationId, `conflict: unknown op ${(event as any).op}`);
  }

  return {
    handleConflict,
  };
}