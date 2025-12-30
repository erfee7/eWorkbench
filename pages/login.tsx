// pages/login.tsx

import * as React from 'react';
import Head from 'next/head';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await signIn('credentials', {
        redirect: false,
        username,
        password,
        callbackUrl: '/',
      });

      if (!res || res.error) {
        setError('Invalid username or password.');
        return;
      }

      // Force a full reload so boot-time Zustand persist keys re-initialize cleanly
      // under the authenticated ew_uid namespace.
      window.location.href = res.url || '/';
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Login</title>
      </Head>

      <main style={{ maxWidth: 420, margin: '64px auto', padding: 16 }}>
        <h1 style={{ margin: '0 0 16px 0' }}>Login</h1>

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
              disabled={submitting}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 12 }}>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
              disabled={submitting}
            />
          </label>

          {error && (
            <div style={{ marginBottom: 12, color: '#b00020' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting} style={{ padding: '8px 12px' }}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </>
  );
}