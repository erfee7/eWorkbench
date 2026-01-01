// src/server/db/pgPool.ts

import { Pool } from 'pg';
import { securityConfig } from '~/server/security/securityConfig';

/**
 * Shared Postgres pool for the app (auth + sync).
 *
 * Next.js dev mode may reload modules; to avoid creating too many pools,
 * we keep a singleton on globalThis.
 */
declare global {
  // eslint-disable-next-line no-var
  var __eWorkbenchPgPool: Pool | undefined;
}

export function getPgPool(): Pool {
  if (globalThis.__eWorkbenchPgPool)
    return globalThis.__eWorkbenchPgPool;

  const url = process.env.PG_DATABASE_URL;
  if (!url)
    throw new Error('PG_DATABASE_URL not configured');

  const statementTimeout = securityConfig.pg.statementTimeoutMs;
  const pgOptions = statementTimeout > 0
    ? `-c statement_timeout=${statementTimeout}`
    : undefined;

  const pool = new Pool({
    connectionString: url,
    max: securityConfig.pg.poolMax,
    connectionTimeoutMillis: securityConfig.pg.connectionTimeoutMs,
    idleTimeoutMillis: securityConfig.pg.idleTimeoutMs,

    // Guardrail: prevents long-running queries from tying up the DB indefinitely.
    // Disable by setting PG_STATEMENT_TIMEOUT_MS=0.
    options: pgOptions,
  });

  globalThis.__eWorkbenchPgPool = pool;
  return pool;
}