// src/server/sync/syncDb.ts

import { Pool } from 'pg';
import { securityConfig } from '~/server/security/securityConfig';

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

  const url = process.env.PG_DATABASE_URL;
  if (!url) {
    // Do not throw at import-time; throw only when actually used.
    // This makes builds safer when sync is not configured.
    throw new Error('PG_DATABASE_URL not configured');
  }

  const statementTimeout = securityConfig.pg.statementTimeoutMs;
  const pgOptions = statementTimeout > 0
    ? `-c statement_timeout=${statementTimeout}`
    : undefined;

  const pool = new Pool({
    connectionString: url,
    max: securityConfig.pg.poolMax,
    connectionTimeoutMillis: securityConfig.pg.connectionTimeoutMs,
    idleTimeoutMillis: securityConfig.pg.idleTimeoutMs,

    // Pragmatic guardrail: prevents a request from tying up DB forever.
    // (Disable by setting PG_STATEMENT_TIMEOUT_MS=0)
    options: pgOptions,
  });

  globalThis.__bigAgiSyncPgPool = pool;
  return pool;
}