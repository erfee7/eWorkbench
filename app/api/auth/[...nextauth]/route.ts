// app/api/auth/[...nextauth]/route.ts

import NextAuth from 'next-auth';
import { nextAuthOptions } from '~/server/auth/nextAuthOptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Next.js route handlers must only export HTTP methods + route config.
// Do NOT export nextAuthOptions from this file.
const handler = NextAuth(nextAuthOptions);

export { handler as GET, handler as POST };