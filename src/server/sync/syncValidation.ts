// src/server/sync/syncValidation.ts

import { makeHttpError } from '~/server/http/error';
import { securityConfig } from '~/server/security/securityConfig';

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * nanoid() is URL-safe. This rejects pathological IDs that could bloat DB/logs.
 */
export function requireValidConversationIdOrThrow(conversationId: string): void {
  const maxLen = securityConfig.sync.conversationIdMaxLen;

  if (!conversationId) throw makeHttpError(400, 'missing conversationId');
  if (conversationId.length > maxLen) throw makeHttpError(400, 'conversationId too long');
  if (!SAFE_ID_RE.test(conversationId)) throw makeHttpError(400, 'invalid conversationId');
}