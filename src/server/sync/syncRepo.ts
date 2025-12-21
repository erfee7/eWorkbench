// src/server/sync/syncRepo.ts

import { getSyncPgPool } from './syncDb';
import type {
  SyncConversationId,
  SyncConversationMeta,
  SyncUserId,
} from './syncTypes';

export type SyncWriteResult =
  | { ok: true; revision: number }
  | { ok: false; kind: 'conflict'; currentRevision: number; deleted: boolean }
  | { ok: false; kind: 'notfound' };

export interface SyncConversationRow {
  userId: SyncUserId;
  conversationId: SyncConversationId;
  revision: number;
  deleted: boolean;
  data: unknown | null;
  updatedAt: string;
}

export async function listConversationMetas(userId: SyncUserId): Promise<SyncConversationMeta[]> {
  const pool = getSyncPgPool();

  const res = await pool.query<{
    conversation_id: string;
    revision: string | number;
    deleted: boolean;
    updated_at: Date;
  }>(
    `
      SELECT conversation_id, revision, deleted, updated_at
      FROM sync_conversations
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `,
    [userId],
  );

  return res.rows.map(r => ({
    conversationId: r.conversation_id,
    revision: typeof r.revision === 'string' ? Number(r.revision) : r.revision,
    deleted: r.deleted,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function getConversation(userId: SyncUserId, conversationId: SyncConversationId): Promise<SyncConversationRow | null> {
  const pool = getSyncPgPool();

  const res = await pool.query<{
    user_id: string;
    conversation_id: string;
    revision: string | number;
    deleted: boolean;
    data: any | null;
    updated_at: Date;
  }>(
    `
      SELECT user_id, conversation_id, revision, deleted, data, updated_at
      FROM sync_conversations
      WHERE user_id = $1 AND conversation_id = $2
      LIMIT 1
    `,
    [userId, conversationId],
  );

  if (!res.rows.length) return null;

  const r = res.rows[0];
  return {
    userId: r.user_id,
    conversationId: r.conversation_id,
    revision: typeof r.revision === 'string' ? Number(r.revision) : r.revision,
    deleted: r.deleted,
    data: r.data,
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * Upsert with optimistic concurrency.
 *
 * Semantics:
 * - baseRevision === null means "newly created conversation" -> must not exist remotely.
 * - If it exists remotely, we return 409 conflict (do not overwrite).
 */
export async function tryUpsertConversation(
  userId: SyncUserId,
  conversationId: SyncConversationId,
  baseRevision: number | null,
  data: unknown,
): Promise<SyncWriteResult> {
  const pool = getSyncPgPool();

  if (baseRevision === null) {
    // Create-only: insert if absent; conflict if present.
    const inserted = await pool.query<{ revision: string | number }>(
      `
        INSERT INTO sync_conversations (user_id, conversation_id, revision, deleted, data)
        VALUES ($1, $2, 1, false, $3::jsonb)
        ON CONFLICT (user_id, conversation_id) DO NOTHING
        RETURNING revision
      `,
      [userId, conversationId, JSON.stringify(data)],
    );

    if (inserted.rows.length) {
      const rev = inserted.rows[0].revision;
      return { ok: true, revision: typeof rev === 'string' ? Number(rev) : rev };
    }

    // row exists -> conflict
    const current = await getConversation(userId, conversationId);
    if (!current) return { ok: false, kind: 'conflict', currentRevision: 0, deleted: false }; // extremely unlikely
    return { ok: false, kind: 'conflict', currentRevision: current.revision, deleted: current.deleted };
  }

  // Update-only: must match revision exactly.
  const updated = await pool.query<{ revision: string | number }>(
    `
      UPDATE sync_conversations
      SET
        revision = revision + 1,
        deleted = false,
        data = $4::jsonb,
        updated_at = now()
      WHERE user_id = $1 AND conversation_id = $2 AND revision = $3
      RETURNING revision
    `,
    [userId, conversationId, baseRevision, JSON.stringify(data)],
  );

  if (updated.rows.length) {
    const rev = updated.rows[0].revision;
    return { ok: true, revision: typeof rev === 'string' ? Number(rev) : rev };
  }

  // mismatch or missing -> conflict (or notfound, but conflict is more informative for clients)
  const current = await getConversation(userId, conversationId);
  if (!current) return { ok: false, kind: 'notfound' };
  return { ok: false, kind: 'conflict', currentRevision: current.revision, deleted: current.deleted };
}

/**
 * Tombstone delete with optimistic concurrency.
 *
 * Semantics:
 * - baseRevision === null means "the client believes it does not exist remotely".
 *   If absent -> we CREATE a tombstone (as requested).
 *   If present -> conflict (client is wrong: remote exists).
 * - baseRevision is number -> must match exactly.
 */
export async function tryTombstoneConversation(
  userId: SyncUserId,
  conversationId: SyncConversationId,
  baseRevision: number | null,
): Promise<SyncWriteResult> {
  const pool = getSyncPgPool();

  if (baseRevision === null) {
    // Create tombstone if absent; conflict if present.
    const inserted = await pool.query<{ revision: string | number }>(
      `
        INSERT INTO sync_conversations (user_id, conversation_id, revision, deleted, data)
        VALUES ($1, $2, 1, true, NULL)
        ON CONFLICT (user_id, conversation_id) DO NOTHING
        RETURNING revision
      `,
      [userId, conversationId],
    );

    if (inserted.rows.length) {
      const rev = inserted.rows[0].revision;
      return { ok: true, revision: typeof rev === 'string' ? Number(rev) : rev };
    }

    const current = await getConversation(userId, conversationId);
    if (!current) return { ok: false, kind: 'conflict', currentRevision: 0, deleted: false };
    return { ok: false, kind: 'conflict', currentRevision: current.revision, deleted: current.deleted };
  }

  const updated = await pool.query<{ revision: string | number }>(
    `
      UPDATE sync_conversations
      SET
        revision = revision + 1,
        deleted = true,
        data = NULL,
        updated_at = now()
      WHERE user_id = $1 AND conversation_id = $2 AND revision = $3
      RETURNING revision
    `,
    [userId, conversationId, baseRevision],
  );

  if (updated.rows.length) {
    const rev = updated.rows[0].revision;
    return { ok: true, revision: typeof rev === 'string' ? Number(rev) : rev };
  }

  const current = await getConversation(userId, conversationId);
  if (!current) return { ok: false, kind: 'notfound' };
  return { ok: false, kind: 'conflict', currentRevision: current.revision, deleted: current.deleted };
}