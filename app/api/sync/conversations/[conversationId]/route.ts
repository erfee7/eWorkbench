// app/api/sync/conversations/[conversationId]/route.ts

import type { NextRequest } from 'next/server';
import { requireSyncAuthOrThrow } from '~/server/sync/syncAuth';
import { getConversation, tryTombstoneConversation, tryUpsertConversation } from '~/server/sync/syncRepo';
import type {
  SyncConflictResponse,
  SyncDeleteConversationRequest,
  SyncDeleteConversationResponse,
  SyncGetConversationResponse,
  SyncUpsertConversationRequest,
  SyncUpsertConversationResponse,
} from '~/server/sync/syncTypes';

import { securityConfig } from '~/server/security/securityConfig';
import { requireSameOriginOrThrow } from '~/server/security/originGuard';
import { readJsonWithLimit, readOptionalJsonWithLimit } from '~/server/security/bodyLimit';
import { requireRateLimitOrThrow } from '~/server/security/rateLimit';
import { requireValidConversationIdOrThrow } from '~/server/sync/syncValidation';
import { jsonErrorFromThrowable, jsonNoStore } from '~/server/http/routeResponses';

import { publishConversationChanged } from '~/server/sync/syncNotifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function badRequest(code: string) {
  return jsonNoStore({ error: code }, { status: 400 });
}

function notFound() {
  return jsonNoStore({ error: 'not_found' }, { status: 404 });
}

function conflict(conversationId: string, revision: number, deleted: boolean) {
  const body: SyncConflictResponse = {
    error: 'conflict',
    conversationId,
    revision,
    deleted,
  };
  return jsonNoStore(body, { status: 409 });
}

function parseBaseRevision(value: any): number | null | undefined {
  // undefined means "not provided". We'll treat it as null for convenience,
  // but we validate the type if present.
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return NaN as any;
}

/**
 * GET /api/sync/conversations/:conversationId
 * Fetch full data (opaque blob). Used on revision mismatch/conflict resolution.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ conversationId: string }> }) {
  try {
    const { userId } = await requireSyncAuthOrThrow(req);
    const { conversationId } = await ctx.params;

    requireValidConversationIdOrThrow(conversationId);

    const row = await getConversation(userId, conversationId);
    if (!row) return notFound();

    const body: SyncGetConversationResponse = {
      conversationId: row.conversationId,
      revision: row.revision,
      deleted: row.deleted,
      data: row.deleted ? null : row.data,
    };

    return jsonNoStore(body);
  } catch (err: unknown) {
    return jsonErrorFromThrowable(err, code => ({ error: code }), {
      logLabel: 'sync:get-conversation',
      fallbackCode: 'server_error',
    });
  }
}

/**
 * PUT /api/sync/conversations/:conversationId
 * Upsert opaque conversation blob with optimistic concurrency.
 *
 * IMPORTANT SEMANTICS:
 * - baseRevision === null means "newly created conversation".
 *   If it already exists remotely -> 409 (we never overwrite).
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ conversationId: string }> }) {
  try {
    const { userId } = await requireSyncAuthOrThrow(req);
    const { conversationId } = await ctx.params;

    requireValidConversationIdOrThrow(conversationId);

    // Cookie-auth write endpoint: enforce same-origin in production (nginx-ready).
    if (securityConfig.sync.requireSameOriginWrites) {
      requireSameOriginOrThrow(req);
    }

    // Per-user write throttling: contains buggy clients and casual abuse.
    requireRateLimitOrThrow(`sync-write:${userId}`, {
      maxPerWindow: securityConfig.sync.writeRateLimit.maxPerWindow,
      windowMs: securityConfig.sync.writeRateLimit.windowMs,
      blockMs: securityConfig.sync.writeRateLimit.blockMs,
    });

    const bodyJson = await readJsonWithLimit<Partial<SyncUpsertConversationRequest>>(
      req,
      securityConfig.sync.maxWriteBodyBytes,
    );

    // Basic shape check (avoid weird payloads; still opaque data blob overall).
    if (!bodyJson || typeof bodyJson !== 'object' || Array.isArray(bodyJson)) {
      return badRequest('invalid_body');
    }

    const baseRevisionParsed = parseBaseRevision((bodyJson as any).baseRevision);
    if (Number.isNaN(baseRevisionParsed as any))
      return badRequest('invalid_base_revision');

    // If baseRevision key is missing, treat as null (create semantics).
    // This is forgiving for early clients and manual testing.
    const baseRevision = baseRevisionParsed === undefined ? null : baseRevisionParsed;

    if (bodyJson.data === undefined)
      return badRequest('missing_data');

    // The client payload is expected to contain `.id`.
    const payloadId = (bodyJson.data as any)?.id;
    if (payloadId !== undefined && payloadId !== conversationId) {
      return badRequest('payload_id_mismatch');
    }

    const result = await tryUpsertConversation(userId, conversationId, baseRevision, bodyJson.data);

    if (result.ok) {
      const resp: SyncUpsertConversationResponse = { conversationId, revision: result.revision };

      // Notify other clients for this user to pull updated blob.
      // (Originating client may also receive it; it can ignore by revision.)
      publishConversationChanged(userId, conversationId, result.revision, false);
      
      return jsonNoStore(resp);
    }

    if (result.kind === 'conflict') {
      return conflict(conversationId, result.currentRevision, result.deleted);
    }

    if (result.kind === 'notfound') {
      // baseRevision was non-null but row missing: treat as conflict-ish condition.
      return notFound();
    }

    return jsonNoStore({ error: 'server_error' }, { status: 500 });
  } catch (err: unknown) {
    return jsonErrorFromThrowable(err, code => ({ error: code }), {
      logLabel: 'sync:put-conversation',
      fallbackCode: 'server_error',
    });
  }
}

/**
 * DELETE /api/sync/conversations/:conversationId
 * Tombstone delete with optimistic concurrency.
 *
 * IMPORTANT SEMANTICS:
 * - Deleting a non-existing chat should CREATE a tombstone row.
 * - baseRevision === null means "client believes it does not exist remotely".
 *   -> If absent: create tombstone revision=1
 *   -> If present: 409 conflict
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ conversationId: string }> }) {
  try {
    const { userId } = await requireSyncAuthOrThrow(req);
    const { conversationId } = await ctx.params;

    requireValidConversationIdOrThrow(conversationId);

    if (securityConfig.sync.requireSameOriginWrites) {
      requireSameOriginOrThrow(req);
    }

    requireRateLimitOrThrow(`sync-write:${userId}`, {
      maxPerWindow: securityConfig.sync.writeRateLimit.maxPerWindow,
      windowMs: securityConfig.sync.writeRateLimit.windowMs,
      blockMs: securityConfig.sync.writeRateLimit.blockMs,
    });

    const bodyJson = await readOptionalJsonWithLimit<Partial<SyncDeleteConversationRequest>>(
      req,
      securityConfig.sync.maxWriteBodyBytes,
      {},
    );

    if (!bodyJson || typeof bodyJson !== 'object' || Array.isArray(bodyJson)) {
      return badRequest('invalid_body');
    }

    const baseRevisionParsed = parseBaseRevision((bodyJson as any).baseRevision);
    if (Number.isNaN(baseRevisionParsed as any))
      return badRequest('invalid_base_revision');

    const baseRevision = baseRevisionParsed === undefined ? null : baseRevisionParsed;

    const result = await tryTombstoneConversation(userId, conversationId, baseRevision);

    if (result.ok) {
      const resp: SyncDeleteConversationResponse = { conversationId, revision: result.revision };

      // Notify other clients for this user to pull updated blob.
      // (Originating client may also receive it; it can ignore by revision.)
      publishConversationChanged(userId, conversationId, result.revision, true);

      return jsonNoStore(resp);
    }

    if (result.kind === 'conflict') {
      return conflict(conversationId, result.currentRevision, result.deleted);
    }

    if (result.kind === 'notfound') {
      // If baseRevision is non-null and row missing, we return 404.
      return notFound();
    }

    return jsonNoStore({ error: 'server_error' }, { status: 500 });
  } catch (err: unknown) {
    return jsonErrorFromThrowable(err, code => ({ error: code }), {
      logLabel: 'sync:delete-conversation',
      fallbackCode: 'server_error',
    });
  }
}