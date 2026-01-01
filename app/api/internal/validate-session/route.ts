// app/api/internal/validate-session/route.ts

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { securityConfig } from '~/server/security/securityConfig';
import { requireRateLimitOrThrow } from '~/server/security/rateLimit';
import { getUserById } from '~/server/auth/authRepo';
import { jsonErrorFromThrowable, jsonNoStore } from '~/server/http/routeResponses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Internal session validity check:
 * - JWT must exist and verify
 * - user must exist in PG AND be active
 *
 * Returns JSON always: { valid: boolean }
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      return jsonNoStore({ valid: false }, { status: 503 });
    }

    const token = await getToken({ req, secret });
    const userId = typeof token?.sub === 'string' && token.sub ? token.sub : null;

    // No JWT => not valid (no DB hit).
    if (!userId) {
      return jsonNoStore({ valid: false }, { status: 401 });
    }

    // Technically reachable endpoint: keep a simple per-user limiter.
    requireRateLimitOrThrow(`validate-session:uid:${userId}`, securityConfig.auth.validateRateLimit);

    const user = await getUserById(userId);
    if (!user || !user.isActive) {
      return jsonNoStore({ valid: false }, { status: 401 });
    }

    return jsonNoStore({ valid: true });
  } catch (err: unknown) {
    // We intentionally never expose an error code here: middleware only needs { valid }.
    return jsonErrorFromThrowable(err, () => ({ valid: false }), {
      logLabel: 'validate-session',
      fallbackCode: 'server_error',
    });
  }
}