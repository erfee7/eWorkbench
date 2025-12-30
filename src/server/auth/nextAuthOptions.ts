// src/server/auth/nextAuthOptions.ts

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { getUserByUsername } from '~/server/auth/authRepo';
import { verifyPasswordHash } from '~/server/auth/password';
import { securityConfig } from '~/server/security/securityConfig';
import { getClientIpFromHeaders } from '~/server/security/clientIp';
import { consumeRateLimit, resetRateLimit } from '~/server/security/rateLimit';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const nextAuthOptions: NextAuthOptions = {
  // JWT sessions: easiest to read in middleware and route handlers.
  session: { strategy: 'jwt' },

  // Required in production; also used by getToken() verification.
  secret: process.env.NEXTAUTH_SECRET,

  pages: {
    signIn: '/login',
  },

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, req) {
        const username = credentials?.username?.trim();
        const password = credentials?.password;

        if (!username || !password) return null;

        // Prevents casual brute force.
        // IP is only used when EW_TRUST_PROXY=1 (nginx-ready).
        const headers = (req as any)?.headers as Headers | undefined;
        const clientIp = headers ? getClientIpFromHeaders(headers, securityConfig.trustProxy) : null;

        const rlKey = clientIp
          ? `login:${username}:ip:${clientIp}`
          : `login:${username}`;

        const rl = consumeRateLimit(rlKey, {
          maxPerWindow: securityConfig.loginRateLimit.maxAttempts,
          windowMs: securityConfig.loginRateLimit.windowMs,
          blockMs: securityConfig.loginRateLimit.blockMs,
        });

        if (!rl.ok) {
          // Don't reveal rate-limited vs wrong password to the user.
          return null;
        }

        const user = await getUserByUsername(username);
        if (!user || !user.isActive) {
          if (securityConfig.loginRateLimit.failDelayMs > 0)
            await sleep(securityConfig.loginRateLimit.failDelayMs);
          return null;
        }


        // IMPORTANT:
        // Returning { id } makes JWT `sub` become this UUID, which we use as:
        // - ew_uid namespace cookie value
        // - sync user_id key in Postgres
        const ok = await verifyPasswordHash(user.passwordHash, password);
        if (!ok) {
          if (securityConfig.loginRateLimit.failDelayMs > 0)
            await sleep(securityConfig.loginRateLimit.failDelayMs);
          return null;
        }

        // Successful login: clear limiter for this key (keeps UX snappy).
        resetRateLimit(rlKey);

        return { id: user.id, name: user.username };
      },
    }),
  ],

  callbacks: {
    async session({ session, token }) {
      // Attach user id for potential UI usage later (e.g. display/account menus).
      (session.user as any) = {
        ...(session.user || {}),
        id: token.sub,
      };
      return session;
    },
  },
};