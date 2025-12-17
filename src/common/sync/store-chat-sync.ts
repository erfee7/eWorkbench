import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { DConversationId } from '~/common/stores/chat/chat.conversation';

export type ChatSyncOpKind = 'upsert' | 'delete';

interface ChatSyncState {
  /**
   * Last known server revision for each conversation.
   * Unknown = undefined (never synced / never pulled).
   */
  remoteRevisionById: Record<DConversationId, number | undefined>;

  /**
   * What we need to send when sync is enabled.
   * This is intentionally lightweight and persisted:
   * if the user refreshes while offline, we still know we have work to do.
   */
  dirtyOpById: Record<DConversationId, ChatSyncOpKind | undefined>;

  lastAttemptAtById: Record<DConversationId, number | undefined>;
  lastErrorById: Record<DConversationId, string | undefined>;
}

interface ChatSyncActions {
  markDirty: (conversationId: DConversationId, op: ChatSyncOpKind) => void;
  clearDirty: (conversationId: DConversationId) => void;

  setRemoteRevision: (conversationId: DConversationId, revision: number) => void;

  setAttempt: (conversationId: DConversationId, attemptAt: number) => void;
  setError: (conversationId: DConversationId, error: string | undefined) => void;

  /**
   * Optional cleanup utility. We may or may not want to call this on local deletes later.
   * For tombstones, keeping remoteRevision is useful, so this is not auto-used.
   */
  forgetConversation: (conversationId: DConversationId) => void;
}

type ChatSyncStore = ChatSyncState & ChatSyncActions;

export const useChatSyncStore = create<ChatSyncStore>()(
  persist(
    (set, get) => ({
      remoteRevisionById: {},
      dirtyOpById: {},
      lastAttemptAtById: {},
      lastErrorById: {},

      markDirty: (conversationId, op) =>
        set(state => ({
          dirtyOpById: {
            ...state.dirtyOpById,
            [conversationId]: op,
          },
        })),

      clearDirty: (conversationId) =>
        set(state => {
          const { [conversationId]: _removed, ...rest } = state.dirtyOpById;
          return { dirtyOpById: rest };
        }),

      setRemoteRevision: (conversationId, revision) =>
        set(state => ({
          remoteRevisionById: {
            ...state.remoteRevisionById,
            [conversationId]: revision,
          },
        })),

      setAttempt: (conversationId, attemptAt) =>
        set(state => ({
          lastAttemptAtById: {
            ...state.lastAttemptAtById,
            [conversationId]: attemptAt,
          },
        })),

      setError: (conversationId, error) =>
        set(state => ({
          lastErrorById: {
            ...state.lastErrorById,
            [conversationId]: error,
          },
        })),

      forgetConversation: (conversationId) =>
        set(state => {
          const { [conversationId]: _r, ...remoteRevisionById } = state.remoteRevisionById;
          const { [conversationId]: _d, ...dirtyOpById } = state.dirtyOpById;
          const { [conversationId]: _a, ...lastAttemptAtById } = state.lastAttemptAtById;
          const { [conversationId]: _e, ...lastErrorById } = state.lastErrorById;
          return { remoteRevisionById, dirtyOpById, lastAttemptAtById, lastErrorById };
        }),
    }),
    {
      name: 'app-chat-sync',
      version: 1,
      // localStorage default is OK (small metadata).
      partialize: (state) => ({
        remoteRevisionById: state.remoteRevisionById,
        dirtyOpById: state.dirtyOpById,
        lastAttemptAtById: state.lastAttemptAtById,
        lastErrorById: state.lastErrorById,
      }),
    },
  ),
);

/**
 * Mirror the existing big-AGI pattern (e.g. workspaceActions()).
 * Optional, but convenient for non-hook callers.
 */
export function chatSyncActions(): ChatSyncActions {
  const { markDirty, clearDirty, setRemoteRevision, setAttempt, setError, forgetConversation } = useChatSyncStore.getState();
  return { markDirty, clearDirty, setRemoteRevision, setAttempt, setError, forgetConversation };
}