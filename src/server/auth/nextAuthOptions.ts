// src/server/auth/nextAuthOptions.ts

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { getUserByUsername } from '~/server/auth/authRepo';
import { verifyPasswordHash } from '~/server/auth/password';

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

      async authorize(credentials) {
        const username = credentials?.username?.trim();
        const password = credentials?.password;

        if (!username || !password) return null;

        const user = await getUserByUsername(username);
        if (!user || !user.isActive) return null;

        const ok = await verifyPasswordHash(user.passwordHash, password);
        if (!ok) return null;

        // IMPORTANT:
        // Returning { id } makes JWT `sub` become this UUID, which we use as:
        // - ew_uid namespace cookie value
        // - sync user_id key in Postgres
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