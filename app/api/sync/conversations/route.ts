// app/api/sync/conversations/route.ts

import { NextResponse, type NextRequest } from 'next/server';
import { requireSyncAuthOrThrow } from '~/server/sync/syncAuth';
import { listConversationMetas } from '~/server/sync/syncRepo';
import type { SyncListConversationsResponse } from '~/server/sync/syncTypes';

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
    return NextResponse.json(body, {
      headers: {
        // Sync metadata should not be cached by browsers/CDNs.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return NextResponse.json(
      { error: err?.message || 'sync list failed' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}