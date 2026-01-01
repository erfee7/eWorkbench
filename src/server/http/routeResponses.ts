// src/server/http/routeResponses.ts

import { NextResponse } from 'next/server';
import { isHttpErrorLike } from '~/server/http/error';

// Only expose "code-ish" messages to clients (prevents accidental leakage).
const PUBLIC_CODE_RE = /^[a-z0-9_]+$/;

function isPublicCode(message: unknown): message is string {
  return typeof message === 'string' && PUBLIC_CODE_RE.test(message);
}

/**
 * Always force no-store for auth/sync/account endpoints.
 * (We intentionally override any incoming Cache-Control.)
 */
export function noStoreHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(extra || {}),
    'Cache-Control': 'no-store',
  };
}

export function getErrorStatus(err: unknown): number {
  if (isHttpErrorLike(err)) return (err.status as number) || 500;
  return 500;
}

export function getErrorHeaders(err: unknown): Record<string, string> | undefined {
  if (!isHttpErrorLike(err)) return undefined;
  const h = err.headers;
  if (!h || typeof h !== 'object') return undefined;
  return h;
}

/**
 * Public error codes are:
 * - thrown via makeHttpError (status present)
 * - message matches our public code format
 *
 * Anything else is treated as internal and not exposed.
 */
export function getPublicErrorCode(err: unknown): string | null {
  if (!isHttpErrorLike(err)) return null;
  return isPublicCode(err.message) ? err.message : null;
}

export function jsonNoStore<T>(
  body: T,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status,
    headers: noStoreHeaders(init?.headers),
  });
}

type JsonErrorOptions = {
  fallbackCode?: string;      // default: 'server_error'
  extraHeaders?: Record<string, string>;
  logLabel?: string;          // short tag to identify where it happened
};

/**
 * Standardized "catch(err)" JSON response helper.
 * Keeps endpoint-specific envelopes via makeBody(code).
 */
export function jsonErrorFromThrowable<T>(
  err: unknown,
  makeBody: (code: string) => T,
  opt?: JsonErrorOptions,
): NextResponse {
  const status = getErrorStatus(err);

  const publicCode = getPublicErrorCode(err);
  const code = publicCode ?? opt?.fallbackCode ?? 'server_error';

  // Only log unexpected/internal errors (helps debugging without leaking to client).
  if (!publicCode) {
    const label = opt?.logLabel ? `[${opt.logLabel}] ` : '';
    // eslint-disable-next-line no-console
    console.error(`${label}unexpected error`, err);
  }

  const headers = noStoreHeaders({
    ...(getErrorHeaders(err) || {}),
    ...(opt?.extraHeaders || {}),
  });

  return NextResponse.json(makeBody(code), { status, headers });
}