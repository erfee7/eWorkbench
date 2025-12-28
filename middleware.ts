// middleware.ts

import { NextResponse, type NextRequest } from 'next/server';
import { EW_USER_NAMESPACE_COOKIE, EW_NAMESPACE_DEFAULT } from '~/common/auth/userNamespace';

/**
 * v1 middleware for local multi-user storage partitioning.
 *
 * Today: ensures we always have a namespace cookie (defaults to 'default').
 * Future (Auth.js + JWT): set this to the authenticated user's id, and set to 'anon' when logged out.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const existing = req.cookies.get(EW_USER_NAMESPACE_COOKIE)?.value;
  if (!existing) {
    res.cookies.set(EW_USER_NAMESPACE_COOKIE, EW_NAMESPACE_DEFAULT, {
      path: '/',
      sameSite: 'lax',
      // 'secure' should be enabled in production HTTPS deployments
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