// app/api/sync/events/route.ts

import type { NextRequest } from 'next/server';

import { requireSyncAuthOrThrow } from '~/server/sync/syncAuth';
import { subscribeSyncRealtime } from '~/server/sync/syncNotifier';
import type { SyncRealtimeEvent } from '~/server/sync/syncNotifier';

import { jsonErrorFromThrowable, noStoreHeaders } from '~/server/http/routeResponses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keep the stream alive through intermediaries.
// (nginx/caches may still close it; client reconnect handles that.)
const PING_MS = 25_000;

// Force periodic reconnects so middleware gating (PG user active) is re-applied regularly.
const TTL_MS = 60_000;

// Client reconnect hint (EventSource uses this after disconnect).
const RETRY_MS = 3_000;

function formatSseEvent(eventName: string, data: unknown): string {
  // SSE format: lines, blank line terminates one event.
  // JSON is single-line by default, so safe for "data:".
  return `event: ${eventName}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * GET /api/sync/events
 *
 * Server-Sent Events (SSE) notification channel:
 * - informs other clients to pull updated conversation blobs
 * - does NOT include the blob payload, only metadata
 *
 * Reverse proxy readiness (nginx):
 * - sends X-Accel-Buffering: no
 * - uses keepalive pings
 * - uses TTL close to avoid indefinite connections
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireSyncAuthOrThrow(req);

    const encoder = new TextEncoder();

    // We store cleanup refs here so cancel/abort can close cleanly.
    let closed = false;
    let unsubscribe: null | (() => void) = null;
    let pingHandle: ReturnType<typeof setInterval> | null = null;
    let ttlHandle: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (closed) return;
      closed = true;

      try {
        if (unsubscribe) unsubscribe();
      } finally {
        unsubscribe = null;
      }

      if (pingHandle) clearInterval(pingHandle);
      pingHandle = null;

      if (ttlHandle) clearTimeout(ttlHandle);
      ttlHandle = null;

      if (abortHandler) {
        req.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }

      try {
        controller.close();
      } catch {
        // ignore: controller may already be closed
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const sendRaw = (text: string) => {
          if (closed) return;
          controller.enqueue(encoder.encode(text));
        };

        const sendEvent = (eventName: string, payload: unknown) => {
          sendRaw(formatSseEvent(eventName, payload));
        };

        // Reconnect policy hint
        sendRaw(`retry: ${RETRY_MS}\n\n`);

        // Initial "ready" event (useful for debugging)
        sendEvent('ready', { t: Date.now() });

        // Subscribe to per-user events
        unsubscribe = subscribeSyncRealtime(userId, (event: SyncRealtimeEvent) => {
          // We use the event.type as the SSE event name.
          // This makes client code simpler and extensible.
          sendEvent(event.type, event);
        });

        // Keepalive ping
        pingHandle = setInterval(() => {
          sendEvent('ping', { t: Date.now() });
        }, PING_MS);

        // TTL: close to re-apply middleware gate on reconnect
        ttlHandle = setTimeout(() => {
          sendEvent('close', { reason: 'ttl', t: Date.now() });
          close(controller);
        }, TTL_MS);

        // Client disconnected
        abortHandler = () => close(controller);
        req.signal.addEventListener('abort', abortHandler);
      },

      cancel() {
        // cancel() can be called without start() completing in some edge cases.
        // We can't reference controller here, so start() must already handle abort.
        closed = true;
        if (unsubscribe) unsubscribe();
        unsubscribe = null;

        if (pingHandle) clearInterval(pingHandle);
        pingHandle = null;

        if (ttlHandle) clearTimeout(ttlHandle);
        ttlHandle = null;

        if (abortHandler) {
          req.signal.removeEventListener('abort', abortHandler);
          abortHandler = null;
        }
      },
    });

    const headers = noStoreHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Connection': 'keep-alive',

      // nginx: prevent response buffering for SSE
      'X-Accel-Buffering': 'no',

      // Some proxies try to transform/compress streams; discourage that.
      'Cache-Control': 'no-store, no-transform',
    });

    return new Response(stream, { status: 200, headers });
  } catch (err: unknown) {
    // For auth/misconfig/429: keep existing JSON error policy.
    // EventSource will see non-200 and treat it as error/reconnect.
    return jsonErrorFromThrowable(err, code => ({ error: code }), {
      logLabel: 'sync:events',
      fallbackCode: 'server_error',
    });
  }
}