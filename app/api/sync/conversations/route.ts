// app/api/sync/conversations/route.ts

import type { NextRequest } from 'next/server';
import { requireSyncAuthOrThrow } from '~/server/sync/syncAuth';
import { listConversationMetas } from '~/server/sync/syncRepo';
import type { SyncListConversationsResponse } from '~/server/sync/syncTypes';
import { jsonErrorFromThrowable, jsonNoStore } from '~/server/http/routeResponses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sync/conversations
 * Metadata-only list for initial pull.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireSyncAuthOrThrow(req);

    const items = await listConversationMetas(userId);

    const body: SyncListConversationsResponse = { items };
    return jsonNoStore(body);
  } catch (err: unknown) {
    return jsonErrorFromThrowable(err, code => ({ error: code }), {
      logLabel: 'sync:list-conversations',
      fallbackCode: 'server_error',
    });
  }
}