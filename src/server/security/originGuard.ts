// src/server/security/originGuard.ts

import { makeHttpError } from '~/server/http/error';
import type { HeadersLike } from '~/server/http/headersLike';
import { readHeader } from '~/server/http/headersLike';

export function getExpectedOriginFromNextAuthUrl(): string | null {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Cookie-auth write endpoints should be same-origin.
 * We use NEXTAUTH_URL as the source of truth for the public origin.
 *
 * Accepts "request-like" objects so this guard can be reused in Node/NextAuth contexts.
 */
export function requireSameOriginOrThrow(req: { headers: HeadersLike }): void {
  const expected = getExpectedOriginFromNextAuthUrl();
  if (!expected) {
    // Misconfiguration: we can't safely validate Origin.
    throw makeHttpError(503, 'server_misconfigured');
  }

  const origin = readHeader(req.headers, 'origin');
  if (!origin) throw makeHttpError(403, 'missing_origin');
  if (origin !== expected) throw makeHttpError(403, 'bad_origin');
}