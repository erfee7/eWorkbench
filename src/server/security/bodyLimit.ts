// src/server/security/bodyLimit.ts

import { makeHttpError } from '~/server/http/error';

export async function readTextWithLimit(req: Request, maxBytes: number): Promise<string> {
  // If body is absent, treat as empty.
  if (!req.body) return '';

  // If Content-Length is present and already too large, fail early.
  const cl = req.headers.get('content-length');
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      throw makeHttpError(413, 'payload_too_large');
    }
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    if (received > maxBytes) {
      throw makeHttpError(413, 'payload_too_large');
    }
    chunks.push(value);
  }

  if (!chunks.length) return '';

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  return new TextDecoder().decode(merged);
}

export async function readJsonWithLimit<T = any>(req: Request, maxBytes: number): Promise<T> {
  const text = await readTextWithLimit(req, maxBytes);
  if (!text.trim()) {
    throw makeHttpError(400, 'missing_json_body');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw makeHttpError(400, 'invalid_json');
  }
}

/**
 * For endpoints where body is optional (e.g. DELETE).
 */
export async function readOptionalJsonWithLimit<T = any>(req: Request, maxBytes: number, fallback: T): Promise<T> {
  const text = await readTextWithLimit(req, maxBytes);
  if (!text.trim()) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw makeHttpError(400, 'invalid_json');
  }
}