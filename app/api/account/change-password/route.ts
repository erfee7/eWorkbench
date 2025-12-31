// app/api/account/change-password/route.ts

import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { PASSWORD_MIN_LEN } from '~/common/auth/passwordPolicy';
import { getUserById, updateUserPasswordHash } from '~/server/auth/authRepo';
import { hashPassword, verifyPasswordHash } from '~/server/auth/password';
import { requireSameOriginOrThrow } from '~/server/security/originGuard';
import { securityConfig } from '~/server/security/securityConfig';
import { getClientIpFromHeaders } from '~/server/security/clientIp';
import { consumeRateLimit, resetRateLimit } from '~/server/security/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStoreHeaders(extra?: Record<string, string>) {
  return { 'Cache-Control': 'no-store', ...(extra || {}) };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type ChangePasswordBody = {
  oldPassword?: string;
  newPassword?: string;
  newPasswordConfirm?: string;
};

function jsonError(status: number, error: string, extraHeaders?: Record<string, string>) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: noStoreHeaders(extraHeaders) },
  );
}

export async function POST(req: NextRequest) {
  try {
    // Cookie-auth write endpoint: require same-origin (defense in depth).
    requireSameOriginOrThrow(req);

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret)
      return jsonError(503, 'server_misconfigured');

    const token = await getToken({ req, secret });
    const userId = typeof token?.sub === 'string' && token.sub ? token.sub : null;

    if (!userId)
      return jsonError(401, 'unauthorized');

    // Reuse the login limiter settings (as requested), but scope key to this operation.
    // IP is only used when EW_TRUST_PROXY=1 (nginx-ready), consistent with login.
    const clientIp = getClientIpFromHeaders(req.headers, securityConfig.trustProxy);
    const rlKey = clientIp
      ? `change-password:uid:${userId}:ip:${clientIp}`
      : `change-password:uid:${userId}`;

    const rl = consumeRateLimit(rlKey, {
      maxPerWindow: securityConfig.loginRateLimit.maxAttempts,
      windowMs: securityConfig.loginRateLimit.windowMs,
      blockMs: securityConfig.loginRateLimit.blockMs,
    });

    if (!rl.ok) {
      // Here we *can* be explicit: user is already authenticated, so "429" is fine UX.
      const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      return jsonError(429, 'rate_limited', { 'Retry-After': String(retryAfterSec) });
    }

    let body: ChangePasswordBody;
    try {
      body = (await req.json()) as ChangePasswordBody;
    } catch {
      return jsonError(400, 'bad_json');
    }

    const oldPassword = body.oldPassword || '';
    const newPassword = body.newPassword || '';
    const newPasswordConfirm = body.newPasswordConfirm || '';

    if (!oldPassword || !newPassword || !newPasswordConfirm)
      return jsonError(400, 'missing_fields');

    if (newPassword.length < PASSWORD_MIN_LEN)
      return jsonError(400, 'new_password_too_short');

    if (newPassword !== newPasswordConfirm)
      return jsonError(400, 'new_password_mismatch');

    if (newPassword === oldPassword)
      return jsonError(400, 'new_password_same_as_old');

    const user = await getUserById(userId);
    if (!user || !user.isActive) {
      // Don't leak details: treat as unauthorized.
      return jsonError(401, 'unauthorized');
    }

    const okOld = await verifyPasswordHash(user.passwordHash, oldPassword);
    if (!okOld) {
      // Match login behavior: small delay on credential failure.
      if (securityConfig.loginRateLimit.failDelayMs > 0)
        await sleep(securityConfig.loginRateLimit.failDelayMs);

      // Keep error generic; UI can phrase it nicely.
      return jsonError(401, 'invalid_old_password');
    }

    const newHash = await hashPassword(newPassword);

    const updated = await updateUserPasswordHash(userId, newHash);
    if (!updated)
      return jsonError(500, 'update_failed');

    // Successful change: clear limiter for snappy UX (same idea as login).
    resetRateLimit(rlKey);

    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });

  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return NextResponse.json(
      { ok: false, error: 'server_error' },
      { status, headers: noStoreHeaders(err?.headers) },
    );
  }
}