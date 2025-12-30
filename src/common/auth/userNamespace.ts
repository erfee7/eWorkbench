// src/common/auth/userNamespace.ts

/**
 * Local user namespace (v1).
 *
 * This is NOT authentication.
 * It's only used to partition persisted client storage (IndexedDB/localStorage)
 * so multiple users on the same browser profile do not see each other's data.
 *
 * Later, middleware will set this cookie from a real JWT session (Auth.js).
 */

export const EW_USER_NAMESPACE_COOKIE = 'ew_uid';

// Namespace values (conventions)
export const EW_NAMESPACE_DEFAULT = 'default';
export const EW_NAMESPACE_UNAUTH = 'unauth';

/** Keep the namespace safe for use inside storage keys/cookies. */
export function normalizeUserNamespace(raw: string): string {
  // allow UUIDs / cuids / simple strings; replace anything else
  return raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || EW_NAMESPACE_DEFAULT;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const cookie of cookies) {
    const [k, ...rest] = cookie.split('=');
    if (!k) continue;
    if (k.trim() !== name) continue;
    return decodeURIComponent(rest.join('=').trim());
  }
  return null;
}

/**
 * Returns the namespace used to scope persisted stores.
 * Must be synchronous (stores are created at module import time).
 */
export function getBootUserNamespace(): string {
  // SSR: doesn't matter (we don't read IDB on server anyway)
  if (typeof window === 'undefined') return EW_NAMESPACE_DEFAULT;

  const fromCookie = readCookie(EW_USER_NAMESPACE_COOKIE);
  return normalizeUserNamespace(fromCookie ?? EW_NAMESPACE_DEFAULT);
}

/** True when we should avoid starting background sync tasks. */
export function isUnauthorizedNamespace(namespace: string): boolean {
  return namespace === EW_NAMESPACE_UNAUTH;
}

/**
 * Build a per-user storage key. Example:
 *  baseKey='app-chats' -> 'app-chats:default' (or ':<userId>' later)
 */
export function makeUserScopedKey(baseKey: string): string {
  const ns = getBootUserNamespace();
  return `${baseKey}:${ns}`;
}