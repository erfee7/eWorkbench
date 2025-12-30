// app/api/sync/conversations/[conversationId]/route.ts

import { NextResponse, type NextRequest } from 'next/server';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

function conflict(conversationId: string, revision: number, deleted: boolean) {
  const body: SyncConflictResponse = {
    error: 'conflict',
    conversationId,
    revision,
    deleted,
  };
  return NextResponse.json(body, { status: 409, headers: { 'Cache-Control': 'no-store' } });
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

    if (!conversationId)
      return badRequest('missing conversationId');

    const row = await getConversation(userId, conversationId);
    if (!row) {
      return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const body: SyncGetConversationResponse = {
      conversationId: row.conversationId,
      revision: row.revision,
      deleted: row.deleted,
      data: row.deleted ? null : row.data,
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return NextResponse.json(
      { error: err?.message || 'sync get failed' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
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

    if (!conversationId)
      return badRequest('missing conversationId');

    const bodyJson = (await req.json()) as Partial<SyncUpsertConversationRequest>;

    const baseRevisionParsed = parseBaseRevision((bodyJson as any).baseRevision);
    if (Number.isNaN(baseRevisionParsed as any))
      return badRequest('invalid baseRevision (must be number or null)');

    // If baseRevision key is missing, treat as null (create semantics).
    // This is forgiving for early clients and manual testing.
    const baseRevision = baseRevisionParsed === undefined ? null : baseRevisionParsed;

    if (bodyJson.data === undefined)
      return badRequest('missing data');

    // Optional but strongly recommended: enforce path id == payload id to avoid mistakes.
    // The client payload is expected to contain `.id`.
    const payloadId = (bodyJson.data as any)?.id;
    if (payloadId !== undefined && payloadId !== conversationId) {
      return badRequest('payload id does not match conversationId path param');
    }

    const result = await tryUpsertConversation(userId, conversationId, baseRevision, bodyJson.data);

    if (result.ok) {
      const resp: SyncUpsertConversationResponse = { conversationId, revision: result.revision };
      return NextResponse.json(resp, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (result.kind === 'conflict') {
      return conflict(conversationId, result.currentRevision, result.deleted);
    }

    if (result.kind === 'notfound') {
      // baseRevision was non-null but row missing: treat as conflict-ish condition.
      return NextResponse.json(
        { error: 'not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json({ error: 'unknown error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return NextResponse.json(
      { error: err?.message || 'sync put failed' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
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

    if (!conversationId)
      return badRequest('missing conversationId');

    // DELETE bodies are allowed here (Next route handlers + fetch are fine with it).
    // If a client/tool cannot send a body, we'll treat missing baseRevision as null.
    let bodyJson: Partial<SyncDeleteConversationRequest> = {};
    try {
      bodyJson = (await req.json()) as Partial<SyncDeleteConversationRequest>;
    } catch {
      // no body -> baseRevision defaults to null below
    }

    const baseRevisionParsed = parseBaseRevision((bodyJson as any).baseRevision);
    if (Number.isNaN(baseRevisionParsed as any))
      return badRequest('invalid baseRevision (must be number or null)');

    const baseRevision = baseRevisionParsed === undefined ? null : baseRevisionParsed;

    const result = await tryTombstoneConversation(userId, conversationId, baseRevision);

    if (result.ok) {
      const resp: SyncDeleteConversationResponse = { conversationId, revision: result.revision };
      return NextResponse.json(resp, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (result.kind === 'conflict') {
      return conflict(conversationId, result.currentRevision, result.deleted);
    }

    if (result.kind === 'notfound') {
      // If baseRevision is non-null and row missing, we return 404.
      // (Alternatively could 409, but 404 makes debugging clearer.)
      return NextResponse.json(
        { error: 'not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json({ error: 'unknown error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return NextResponse.json(
      { error: err?.message || 'sync delete failed' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}