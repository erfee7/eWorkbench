// src/common/privacy/purgeLocalUserData.ts

import { del as idbDel } from 'idb-keyval';

import { makeUserScopedKey } from '~/common/auth/userNamespace';


/**
 * Purge *local-only* chat history + sync metadata for the current user namespace.
 *
 * Privacy intent:
 * - Clears browser-stored data for the current ew_uid namespace
 * - Does NOT call any app-level delete flows (so it won't enqueue cloud deletes)
 *
 * Notes:
 * - Chats are stored in IndexedDB via idb-keyval under the per-user key makeUserScopedKey('app-chats').
 * - Sync metadata is stored in localStorage under makeUserScopedKey('app-chat-sync').
 * - We intentionally do not modify idbUtils.ts, so we can't coordinate with its write scheduler.
 *   To reduce races with delayed writes, we delete the IDB key twice with a short wait in between.
 */
export async function purgeLocalChatAndSyncMetadataForCurrentUser(): Promise<void> {
  const chatIdbKey = makeUserScopedKey('app-chats');
  const syncLsKey = makeUserScopedKey('app-chat-sync');

  const errors: string[] = [];

  // 1) localStorage: small metadata, remove synchronously (best-effort)
  try {
    if (typeof window !== 'undefined' && 'localStorage' in window)
      localStorage.removeItem(syncLsKey);
  } catch (error: any) {
    console.warn('Failed to remove sync metadata from localStorage:', error);
    errors.push('Failed to clear sync metadata.');
  }

  // 2) IndexedDB: remove persisted chat blob for this user namespace
  try {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      // First delete removes what's there now.
      await idbDel(chatIdbKey);

      // Wait to catch delayed writes (idbUtils has a deadline-based scheduler).
      // Keep this short, but long enough to cover the scheduler deadline + typical timer clamping.
      await waitMs(2500);

      // Second delete removes anything that might have been written after the first delete.
      await idbDel(chatIdbKey);
    }
  } catch (error: any) {
    console.warn('Failed to remove chats from IndexedDB:', error);
    errors.push('Failed to clear chat history.');
  }

  if (errors.length) {
    // Keep the UI message simple; details are in console.
    throw new Error(errors.join(' '));
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}