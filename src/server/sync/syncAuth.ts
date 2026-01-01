// src/server/sync/syncAuth.ts

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { SyncUserId } from './syncTypes';
import { makeHttpError } from '~/server/http/error';

/**
 * Sync auth v2: derive user from NextAuth JWT session cookie.
 * This enables real per-user remote separation (sync_conversations.user_id).
 */
export async function requireSyncAuthOrThrow(req: NextRequest): Promise<{ userId: SyncUserId }> {
  const secret = process.env.NEXTAUTH_SECRET;

  // 503: server misconfigured (cannot validate sessions)
  if (!secret) {
    throw makeHttpError(503, 'server_misconfigured');
  }

  const token = await getToken({ req, secret });
  const userId = typeof token?.sub === 'string' ? token.sub : null;

  if (!userId) {
    throw makeHttpError(401, 'unauthorized');
  }

  return { userId };
}