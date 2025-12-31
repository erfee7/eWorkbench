// src/server/sync/syncDb.ts

import type { Pool } from 'pg';
import { getPgPool } from '~/server/db/pgPool';

/**
 * @deprecated
 * Sync and auth share the same Postgres database now (PG_DATABASE_URL).
 * Use getPgPool() from ~/server/db/pgPool instead.
 */
export function getSyncPgPool(): Pool {
  return getPgPool();
}