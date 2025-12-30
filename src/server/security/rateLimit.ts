// src/server/security/rateLimit.ts

import { makeHttpError } from './httpError';

type Entry = {
  windowStart: number;
  count: number;
  blockedUntil: number;
  lastSeen: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __ewRateLimitStore: Map<string, Entry> | undefined;
}

function store(): Map<string, Entry> {
  if (!globalThis.__ewRateLimitStore) globalThis.__ewRateLimitStore = new Map();
  return globalThis.__ewRateLimitStore;
}

export type RateLimitOptions = {
  windowMs: number;
  maxPerWindow: number;
  blockMs: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

/**
 * Fixed-window limiter with temporary blocking when exceeded.
 * Not perfect, but enough to stop casual brute forcing / loops.
 */
export function consumeRateLimit(key: string, opt: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const m = store();

  // Opportunistic cleanup: keep memory bounded.
  // Removes entries unused for > 1 hour.
  if (m.size > 10_000) {
    for (const [k, e] of m.entries()) {
      if (now - e.lastSeen > 60 * 60 * 1000) m.delete(k);
    }
  }

  const e = m.get(key) || {
    windowStart: now,
    count: 0,
    blockedUntil: 0,
    lastSeen: now,
  };

  e.lastSeen = now;

  if (e.blockedUntil > now) {
    m.set(key, e);
    return { ok: false, retryAfterMs: e.blockedUntil - now };
  }

  if (now - e.windowStart >= opt.windowMs) {
    e.windowStart = now;
    e.count = 0;
  }

  e.count += 1;

  if (e.count > opt.maxPerWindow) {
    e.blockedUntil = now + opt.blockMs;
    m.set(key, e);
    return { ok: false, retryAfterMs: opt.blockMs };
  }

  m.set(key, e);
  return { ok: true };
}

export function resetRateLimit(key: string): void {
  store().delete(key);
}

/**
 * Convenience: throw an HTTP 429 with Retry-After header.
 */
export function requireRateLimitOrThrow(key: string, opt: RateLimitOptions): void {
  const res = consumeRateLimit(key, opt);
  if (res.ok) return;

  const retryAfterSec = Math.max(1, Math.ceil(res.retryAfterMs / 1000));
  throw makeHttpError(429, 'rate_limited', {
    'Retry-After': String(retryAfterSec),
  });
}