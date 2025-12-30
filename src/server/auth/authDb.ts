// src/server/auth/authDb.ts

import type { Pool } from 'pg';
import { getSyncPgPool } from '~/server/sync/syncDb';

/**
 * Auth and sync share the same Postgres database for now (PG_DATABASE_URL).
 * This avoids touching upstream Prisma wiring.
 */
export function getAuthPgPool(): Pool {
  return getSyncPgPool();
}