// src/server/sync/syncDb.ts

import { Pool } from 'pg';

/**
 * Next.js dev mode may reload modules. To avoid creating too many pools,
 * we keep a singleton on globalThis.
 */
declare global {
  // eslint-disable-next-line no-var
  var __bigAgiSyncPgPool: Pool | undefined;
}

export function getSyncPgPool(): Pool {
  if (globalThis.__bigAgiSyncPgPool)
    return globalThis.__bigAgiSyncPgPool;

  const url = process.env.SYNC_DATABASE_URL;
  if (!url) {
    // Do not throw at import-time; throw only when actually used.
    // This makes builds safer when sync is not configured.
    throw new Error('SYNC_DATABASE_URL not configured');
  }

  const pool = new Pool({
    connectionString: url,
  });

  globalThis.__bigAgiSyncPgPool = pool;
  return pool;
}