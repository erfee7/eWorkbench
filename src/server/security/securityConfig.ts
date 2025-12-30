// src/server/security/securityConfig.ts

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

function envBool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return def;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

/**
 * Centralized security defaults (env-overridable).
 * Keep these here so operators can tune without touching route handlers.
 */
export const securityConfig = {
  // When behind nginx, set EW_TRUST_PROXY=1 to trust X-Forwarded-For / X-Real-IP.
  trustProxy: envBool('EW_TRUST_PROXY', false),

  // ---- Login brute-force throttling (Credentials authorize) ----
  loginRateLimit: {
    // max attempts in a fixed window
    maxAttempts: envInt('EW_LOGIN_MAX_ATTEMPTS', 10),
    windowMs: envInt('EW_LOGIN_WINDOW_MS', 10 * 60 * 1000),
    blockMs: envInt('EW_LOGIN_BLOCK_MS', 10 * 60 * 1000),

    // Small delay on failed auth helps against online guessing without hurting real users much.
    // Set to 0 to disable.
    failDelayMs: envInt('EW_LOGIN_FAIL_DELAY_MS', 250),
  },

  // ---- Sync request protections ----
  sync: {
    // App-level payload cap (nginx should also enforce later).
    maxWriteBodyBytes: envInt('EW_SYNC_MAX_BODY_BYTES', 32 * 1024 * 1024),

    // Per-user sync write rate limit (PUT/DELETE), fixed window.
    writeRateLimit: {
      maxPerWindow: envInt('EW_SYNC_WRITE_MAX_PER_WINDOW', 60),
      windowMs: envInt('EW_SYNC_WRITE_WINDOW_MS', 60 * 1000),
      blockMs: envInt('EW_SYNC_WRITE_BLOCK_MS', 60 * 1000),
    },

    // Same-origin enforcement for cookie-auth write endpoints.
    // Default: on in production.
    requireSameOriginWrites: envBool(
      'EW_SYNC_REQUIRE_SAME_ORIGIN_WRITES',
      process.env.NODE_ENV === 'production',
    ),

    // conversationId validation (nanoid-safe)
    conversationIdMaxLen: envInt('EW_SYNC_CONVERSATION_ID_MAX_LEN', 128),
  },

  // ---- Postgres pool guardrails ----
  pg: {
    poolMax: envInt('PG_POOL_MAX', 10),
    connectionTimeoutMs: envInt('PG_POOL_CONNECTION_TIMEOUT_MS', 3000),
    idleTimeoutMs: envInt('PG_POOL_IDLE_TIMEOUT_MS', 30_000),

    // Statement timeout is a pragmatic DoS guardrail.
    // Set 0 to disable.
    statementTimeoutMs: envInt('PG_STATEMENT_TIMEOUT_MS', 8000),
  },
};