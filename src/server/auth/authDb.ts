// src/server/auth/authDb.ts

import type { Pool } from 'pg';
import { getPgPool } from '~/server/db/pgPool';

/**
 * @deprecated
 * Auth and sync share the same Postgres database now (PG_DATABASE_URL).
 * Use getPgPool() from ~/server/db/pgPool instead.
 */
export function getAuthPgPool(): Pool {
  return getPgPool();
}