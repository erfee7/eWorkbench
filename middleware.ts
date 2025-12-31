// middleware.ts

import { NextResponse, type NextRequest } from 'next/server';
import { getToken, encode, decode } from 'next-auth/jwt';

import {
  EW_USER_NAMESPACE_COOKIE,
  EW_NAMESPACE_UNAUTH,
  normalizeUserNamespace,
} from '~/common/auth/userNamespace';
import { securityConfig } from '~/server/security/securityConfig';

const EW_SESSION_VALID_COOKIE = 'ew_valid';

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isBypassedPath(pathname: string): boolean {
  // NextAuth endpoints must not be gated by our auth middleware.
  if (pathname.startsWith('/api/auth/')) return true;

  // Internal validator endpoint: middleware calls it; must bypass to avoid recursion.
  if (pathname.startsWith('/api/Winternal/')) return true;

  // Edge backend capabilities endpoint: needed for login page to work.
  if (pathname.startsWith('/api/edge/backend.listCapabilities')) return true;

  return false;
}

function jsonResponse(status: number, body: any): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Read the short-lived cache cookie which asserts "session is valid".
 * Cookie is a small NextAuth JWT-like token (signed/encrypted via NEXTAUTH_SECRET).
 */
async function readValidCacheCookie(secret: string, tokenSub: string, raw: string | undefined): Promise<boolean> {
  if (!raw) return false;

  try {
    const decoded = await decode({ token: raw, secret });
    if (!decoded || typeof decoded !== 'object') return false;

    // We store uid explicitly to avoid relying on NextAuth internal fields.
    const uid = (decoded as any).uid;
    const exp = (decoded as any).exp; // seconds since epoch (JWT standard)

    if (typeof uid !== 'string' || uid !== tokenSub) return false;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return false;

    return exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

async function makeValidCacheCookie(secret: string, tokenSub: string, ttlSeconds: number): Promise<string> {
  // Cache payload version allows future format changes.
  return encode({
    secret,
    maxAge: ttlSeconds, // seconds
    token: { uid: tokenSub, v: 1 } as any,
  });
}

/**
 * Hard-gate middleware:
 * - Pages: redirect to /login when session is not valid
 * - APIs: return 401 when session is not valid
 *
 * "Valid session" means:
 * - JWT verifies (token.sub exists)
 * - user exists in Postgres and is_active=true
 *   (cached ~30s via signed HttpOnly cookie, to avoid DB calls on every request)
 *
 * NOTE: ew_uid is NOT auth; it's only the local storage partition selector.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isBypassedPath(pathname))
    return NextResponse.next();

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Fail closed: without a secret, we cannot validate sessions.
    return new NextResponse('NEXTAUTH_SECRET not configured', { status: 503 });
  }

  const isApi = isApiPath(pathname);
  const isLoginPage = pathname === '/login';
  const isLogoutPage = pathname === '/logout';

  // 1) JWT validity (cryptographic): token exists and verifies.
  const token = await getToken({ req, secret });
  const tokenSub = typeof token?.sub === 'string' && token.sub ? token.sub : null;

  // 2) PG-backed validity (cached).
  let sessionValid = false;
  let newValidCookieValue: string | null = null;

  if (tokenSub) {
    const cachedOk = await readValidCacheCookie(secret, tokenSub, req.cookies.get(EW_SESSION_VALID_COOKIE)?.value);

    if (cachedOk) {
      sessionValid = true;
    } else {
      // Ask node runtime to confirm "user exists and is active".
      // Important: forward cookies, otherwise the validator won't see the session.
      const url = new URL('/api/internal/validate-session', req.nextUrl.origin);
      const r = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          cookie: req.headers.get('cookie') ?? '',
          // Forward proxy headers (optional; useful if validator ever rate-limits by IP).
          'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
          'x-real-ip': req.headers.get('x-real-ip') ?? '',
        },
        cache: 'no-store',
      });

      if (r.status === 200) {
        const data = await r.json().catch(() => null);
        if (data?.valid === true) {
          sessionValid = true;

          const ttlSeconds = Math.max(1, securityConfig.auth.validationTtlSeconds);
          newValidCookieValue = await makeValidCacheCookie(secret, tokenSub, ttlSeconds);
        }
      } else if (r.status === 401) {
        sessionValid = false;
      } else {
        // If we cannot determine validity (DB down, etc.), fail closed with 503.
        return new NextResponse('Service unavailable (middleware)', { status: 503 });
      }
    }
  } else {
    sessionValid = false;
  }

  // Redirect/deny rules:
  // - APIs: 401 when invalid (no redirects)
  // - Pages: redirect to /login when invalid
  // - /logout is always allowed to load (canonical sign-out flow)
  const mustDenyApi = isApi && !sessionValid;
  const mustRedirectToLogin = !sessionValid && !isApi && !isLoginPage && !isLogoutPage;
  const shouldRedirectAwayFromLogin = sessionValid && isLoginPage;

  let res: NextResponse;

  if (mustDenyApi) {
    res = jsonResponse(401, { error: 'unauthorized' });
  } else if (mustRedirectToLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    res = NextResponse.redirect(url);
  } else if (shouldRedirectAwayFromLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next();
  }

  // Keep ew_uid synchronized (namespaces persisted storage).
  const desiredNamespace = sessionValid && tokenSub
    ? normalizeUserNamespace(tokenSub)
    : EW_NAMESPACE_UNAUTH;

  const existingNs = req.cookies.get(EW_USER_NAMESPACE_COOKIE)?.value;
  if (existingNs !== desiredNamespace) {
    res.cookies.set(EW_USER_NAMESPACE_COOKIE, desiredNamespace, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // client must read this synchronously at boot for persist keys
      secure: process.env.NODE_ENV === 'production',
    });
  }

  // Maintain/clear validity cache cookie.
  if (sessionValid && newValidCookieValue) {
    res.cookies.set(EW_SESSION_VALID_COOKIE, newValidCookieValue, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: Math.max(1, securityConfig.auth.validationTtlSeconds),
    });
  } else if (!sessionValid) {
    // Clear any stale cache cookie (e.g., after user disable/delete).
    if (req.cookies.get(EW_SESSION_VALID_COOKIE)) {
      res.cookies.set(EW_SESSION_VALID_COOKIE, '', {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      });
    }
  }

  return res;
}

// Apply to all paths except static files.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sitemap.xml).*)',
  ],
};