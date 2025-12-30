// src/server/security/clientIp.ts

/**
 * Extract client IP from proxy headers (only if trustProxy=true).
 * If trustProxy=false, returns null (we avoid guessing remote IP).
 */
export function getClientIpFromHeaders(headers: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null;

  // Standard proxy chain header: "client, proxy1, proxy2"
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;

  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // Optional: Cloudflare, etc.
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  return null;
}