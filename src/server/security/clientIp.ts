// src/server/security/clientIp.ts

type HeaderValue = string | string[] | undefined;

/**
 * Accept both:
 * - Web Headers (Edge runtime, fetch Request)
 * - Plain object headers (NextAuth Credentials authorize() provides this shape)
 *
 * Keep runtime-agnostic: do not import Node types here.
 */
export type HeadersLike = Headers | Record<string, HeaderValue>;

function isWebHeaders(h: unknown): h is Headers {
  return !!h && typeof (h as any).get === 'function';
}

function readHeader(headers: HeadersLike, name: string): string | null {
  const key = name.toLowerCase();

  if (isWebHeaders(headers)) {
    return headers.get(key) ?? headers.get(name) ?? null;
  }

  // NextAuth / Node-style headers objects may have mixed casing.
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() !== key) continue;

    const v = headers[k];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] ?? null;
    return null;
  }

  return null;
}

/**
 * Extract client IP from proxy headers (only if trustProxy=true).
 * If trustProxy=false, returns null (we avoid guessing remote IP).
 */
export function getClientIpFromHeaders(headers: HeadersLike, trustProxy: boolean): string | null {
  if (!trustProxy) return null;

  // Standard proxy chain header: "client, proxy1, proxy2"
  const xff = readHeader(headers, 'x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;

  const realIp = readHeader(headers, 'x-real-ip');
  if (realIp) return realIp.trim();

  // Optional: Cloudflare, etc.
  const cfIp = readHeader(headers, 'cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  return null;
}