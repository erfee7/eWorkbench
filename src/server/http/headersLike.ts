// src/server/http/headersLike.ts

export type HeaderValue = string | string[] | undefined;

/**
 * "Headers-like" type:
 * - Web Headers (Edge runtime, Fetch Request)
 * - Plain object headers (e.g. NextAuth Credentials authorize() request)
 */
export type HeadersLike = Headers | Record<string, HeaderValue>;

export function isWebHeaders(h: unknown): h is Headers {
  return !!h && typeof (h as any).get === 'function';
}

/**
 * Case-insensitive header lookup that works for both Web Headers and plain objects.
 */
export function readHeader(headers: HeadersLike, name: string): string | null {
  const key = name.toLowerCase();

  if (isWebHeaders(headers)) {
    // Headers.get() is already case-insensitive, but we try both to be extra safe.
    return headers.get(key) ?? headers.get(name) ?? null;
  }

  // Plain object: keys may have any casing.
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() !== key) continue;

    const v = headers[k];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] ?? null;
    return null;
  }

  return null;
}