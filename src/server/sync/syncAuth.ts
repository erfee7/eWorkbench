// src/server/sync/syncAuth.ts

import type { NextRequest } from 'next/server';
import type { SyncUserId } from './syncTypes';

/**
 * Sync auth v1: a single shared token for the whole instance.
 */
export function requireSyncAuthOrThrow(req: NextRequest): { userId: SyncUserId } {
  const configuredToken = process.env.SYNC_TOKEN;

  // 503 instead of 401: the server is not configured for sync.
  if (!configuredToken) {
    const err = new Error('SYNC_TOKEN not configured');
    (err as any).status = 503;
    throw err;
  }

  const auth = req.headers.get('authorization') || '';
  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) {
    const err = new Error('missing bearer token');
    (err as any).status = 401;
    throw err;
  }

  const token = auth.slice(prefix.length).trim();
  if (!token || token !== configuredToken) {
    const err = new Error('invalid bearer token');
    (err as any).status = 401;
    throw err;
  }

  // v1: single-user mapping
  return { userId: 'default' };
}