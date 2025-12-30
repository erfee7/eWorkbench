// middleware.ts

import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import {
  EW_USER_NAMESPACE_COOKIE,
  EW_NAMESPACE_UNAUTH,
  normalizeUserNamespace,
} from '~/common/auth/userNamespace';

/**
 * Hard-gate middleware:
 * - If not authenticated: redirect to /login
 * - Always sets ew_uid cookie:
 *   - unauth when logged out
 *   - user UUID when logged in
 *
 * NOTE: ew_uid is NOT authentication; it's only the local storage partition selector.
 * Auth is derived from the NextAuth JWT session.
 */
export async function middleware(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Fail closed: without a secret, we cannot validate sessions.
    return new NextResponse('NEXTAUTH_SECRET not configured', { status: 503 });
  }

  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === '/login';

  const token = await getToken({ req, secret });
  const authedUserId = typeof token?.sub === 'string' && token.sub ? token.sub : null;

  const desiredNamespace = authedUserId
    ? normalizeUserNamespace(authedUserId)
    : EW_NAMESPACE_UNAUTH;

  // Redirect rules (no public pages)
  const mustRedirectToLogin = !authedUserId && !isLoginPage;
  const shouldRedirectAwayFromLogin = !!authedUserId && isLoginPage;

  let res: NextResponse;

  if (mustRedirectToLogin) {
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

  // Keep cookie synchronized (important for user switching and correct persist keys).
  const existing = req.cookies.get(EW_USER_NAMESPACE_COOKIE)?.value;
  if (existing !== desiredNamespace) {
    res.cookies.set(EW_USER_NAMESPACE_COOKIE, desiredNamespace, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // client must read this synchronously at boot for persist keys
      secure: process.env.NODE_ENV === 'production',
    });
  }

  return res;
}

// Apply to all non-API, non-static asset paths.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sitemap.xml).*)',
  ],
};