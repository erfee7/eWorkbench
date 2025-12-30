// pages/logout.tsx

import * as React from 'react';
import Head from 'next/head';
import { signOut } from 'next-auth/react';

export default function LogoutPage() {
  React.useEffect(() => {
    void signOut({ callbackUrl: '/login' });
  }, []);

  return (
    <>
      <Head>
        <title>Logout</title>
      </Head>
      <main style={{ maxWidth: 420, margin: '64px auto', padding: 16 }}>
        <h1 style={{ margin: 0 }}>Signing out…</h1>
      </main>
    </>
  );
}