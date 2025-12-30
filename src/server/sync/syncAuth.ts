// src/server/sync/syncAuth.ts

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { SyncUserId } from './syncTypes';

/**
 * Sync auth v2: derive user from NextAuth JWT session cookie.
 * This enables real per-user remote separation (sync_conversations.user_id).
 */
export async function requireSyncAuthOrThrow(req: NextRequest): Promise<{ userId: SyncUserId }> {
  const secret = process.env.NEXTAUTH_SECRET;

  // 503: server misconfigured (cannot validate sessions)
  if (!secret) {
    const err = new Error('NEXTAUTH_SECRET not configured');
    (err as any).status = 503;
    throw err;
  }

  const token = await getToken({ req, secret });
  const userId = typeof token?.sub === 'string' ? token.sub : null;

  if (!userId) {
    const err = new Error('unauthorized');
    (err as any).status = 401;
    throw err;
  }

  return { userId };
}