// app/api/Winternal/validate-session/route.ts

import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { securityConfig } from '~/server/security/securityConfig';
import { requireRateLimitOrThrow } from '~/server/security/rateLimit';
import { getUserById } from '~/server/auth/authRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStoreHeaders(extra?: Record<string, string>) {
  return { 'Cache-Control': 'no-store', ...(extra || {}) };
}

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
    if (!secret)
      return NextResponse.json({ valid: false }, { status: 503, headers: noStoreHeaders() });

    const token = await getToken({ req, secret });
    const userId = typeof token?.sub === 'string' && token.sub ? token.sub : null;

    // No JWT => not valid (no DB hit).
    if (!userId)
      return NextResponse.json({ valid: false }, { status: 401, headers: noStoreHeaders() });

    // Technically reachable endpoint: keep a simple per-user limiter.
    requireRateLimitOrThrow(`validate-session:uid:${userId}`, securityConfig.auth.validateRateLimit);

    const user = await getUserById(userId);
    if (!user || !user.isActive)
      return NextResponse.json({ valid: false }, { status: 401, headers: noStoreHeaders() });

    return NextResponse.json({ valid: true }, { headers: noStoreHeaders() });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return NextResponse.json(
      { valid: false },
      { status, headers: noStoreHeaders(err?.headers) },
    );
  }
}