// src/server/security/clientIp.ts

import type { HeadersLike } from '~/server/http/headersLike';
import { readHeader } from '~/server/http/headersLike';

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