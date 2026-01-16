// src/server/security/bodyLimit.ts

import { makeHttpError } from '~/server/http/error';
import type { HeadersLike } from '~/server/http/headersLike';
import { readHeader } from '~/server/http/headersLike';

type RequestLike = {
  headers: HeadersLike;
  body?: any;
};

function isWebReadableStream(body: any): body is ReadableStream<Uint8Array> {
  return !!body && typeof body.getReader === 'function';
}

function isNodeReadable(body: any): body is { on: Function; off?: Function; destroy?: Function } {
  return !!body && typeof body.on === 'function';
}

function toUint8(chunk: any): Uint8Array | null {
  if (!chunk) return null;

  if (chunk instanceof Uint8Array) return chunk;

  // Node streams commonly yield Buffer, which is also Uint8Array in Node,
  // but keep this defensive for other chunk shapes.
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);

  try {
    return new Uint8Array(chunk);
  } catch {
    return null;
  }
}

async function readBodyWebStreamWithLimit(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
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

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

async function readBodyNodeStreamWithLimit(
  body: { on: Function; off?: Function; destroy?: Function },
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let received = 0;

  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: any) => {
      const u8 = toUint8(chunk);
      if (!u8) return;

      received += u8.byteLength;
      if (received > maxBytes) {
        // Stop reading early to avoid wasting resources.
        try { body.destroy?.(); } catch { /* ignore */ }
        reject(makeHttpError(413, 'payload_too_large'));
        return;
      }

      chunks.push(u8);
    };

    const onEnd = () => resolve();
    const onError = (err: any) => reject(err);

    body.on('data', onData);
    body.on('end', onEnd);
    body.on('error', onError);
  });

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

export async function readTextWithLimit(req: RequestLike, maxBytes: number): Promise<string> {
  // If body is absent, treat as empty.
  if (!req.body) return '';

  // If Content-Length is present and already too large, fail early.
  const cl = readHeader(req.headers, 'content-length');
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      throw makeHttpError(413, 'payload_too_large');
    }
  }

  let bytes: Uint8Array;

  if (isWebReadableStream(req.body)) {
    bytes = await readBodyWebStreamWithLimit(req.body, maxBytes);
  } else if (isNodeReadable(req.body)) {
    bytes = await readBodyNodeStreamWithLimit(req.body, maxBytes);
  } else {
    // Last-resort fallback: try .text() if caller passed a real Request but body isn't stream-accessible.
    // Limit enforcement is weaker here; we still check size after reading.
    const textFn = (req as any).text;
    if (typeof textFn === 'function') {
      const text = await textFn.call(req);
      const u8 = new TextEncoder().encode(text);
      if (u8.byteLength > maxBytes) throw makeHttpError(413, 'payload_too_large');
      return text;
    }

    throw makeHttpError(500, 'server_error');
  }

  if (!bytes.byteLength) return '';
  return new TextDecoder().decode(bytes);
}

export async function readJsonWithLimit<T = any>(req: RequestLike, maxBytes: number): Promise<T> {
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
export async function readOptionalJsonWithLimit<T = any>(
  req: RequestLike,
  maxBytes: number,
  fallback: T,
): Promise<T> {
  const text = await readTextWithLimit(req, maxBytes);
  if (!text.trim()) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw makeHttpError(400, 'invalid_json');
  }
}