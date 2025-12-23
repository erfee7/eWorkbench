// src/common/sync/chatSyncTransport.http.ts

import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type {
  ChatSyncConflict,
  ChatSyncDeleteRequest,
  ChatSyncDeleteResponse,
  ChatSyncGetConversationResponse,
  ChatSyncListConversationsResponse,
  ChatSyncResult,
  ChatSyncTransport,
  ChatSyncUpsertRequest,
  ChatSyncUpsertResponse,
} from '~/common/sync/chatSyncTransport';

/**
 * TEMP AUTH (per current decision):
 * Hardcode a dev token in client code to unblock end-to-end.
 *
 * Later this should move to a safer mechanism (settings, cookies, PATs, accounts).
 */
const HARD_CODED_SYNC_TOKEN = 'dev-sync-token';

export interface ChatSyncHttpTransportOptions {
  /**
   * Optional override for testing.
   * If omitted, uses HARD_CODED_SYNC_TOKEN.
   */
  token?: string;

  /**
   * Optional base URL. Defaults to same-origin.
   * Useful for tests, reverse proxies, etc.
   */
  baseUrl?: string;
}

function isRetryableHttpStatus(status: number): boolean {
  // conservative retry policy
  return status === 429 || (status >= 500 && status <= 599);
}

async function readJsonSafely(res: Response): Promise<any> {
  // Some errors might return non-JSON. We try JSON first, then fall back to text.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await res.text();
    return text ? { error: text } : null;
  } catch {
    return null;
  }
}

function tryParseConflict(body: any): ChatSyncConflict | undefined {
  // Recognize the server's 409 payload:
  // { error: 'conflict', conversationId, revision, deleted }
  if (!body || typeof body !== 'object') return undefined;
  if (body.error !== 'conflict') return undefined;

  if (typeof body.conversationId !== 'string') return undefined;
  if (typeof body.revision !== 'number' || !Number.isFinite(body.revision) || body.revision < 0) return undefined;
  if (typeof body.deleted !== 'boolean') return undefined;

  return {
    error: 'conflict',
    conversationId: body.conversationId,
    revision: body.revision,
    deleted: body.deleted,
  };
}

export function createChatSyncTransportHttp(options: ChatSyncHttpTransportOptions = {}): ChatSyncTransport {
  const token = options.token ?? HARD_CODED_SYNC_TOKEN;
  const baseUrl = options.baseUrl ?? '';

  async function doFetchJson<T>(path: string, init: RequestInit): Promise<ChatSyncResult<T>> {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });

      if (!res.ok) {
        const body = await readJsonSafely(res);
        const conflict = res.status === 409 ? tryParseConflict(body) : undefined;

        const msg =
          (body && typeof body.error === 'string' && body.error) ||
          `http ${res.status} ${res.statusText}`;

        return {
          ok: false,
          error: msg,
          status: res.status,
          retryable: isRetryableHttpStatus(res.status),
          body,
          conflict,
        };
      }

      // OK
      const json = (await res.json()) as T;
      return { ok: true, value: json };
    } catch (err: any) {
      // network / CORS / DNS / offline
      return {
        ok: false,
        error: err?.message || 'network error',
        retryable: true,
      };
    }
  }

  return {
    mode: 'http',

    // Reads
    listConversations: async (): Promise<ChatSyncResult<ChatSyncListConversationsResponse>> =>
      doFetchJson<ChatSyncListConversationsResponse>('/api/sync/conversations', { method: 'GET' }),

    getConversation: async (conversationId: DConversationId): Promise<ChatSyncResult<ChatSyncGetConversationResponse>> =>
      doFetchJson<ChatSyncGetConversationResponse>(
        `/api/sync/conversations/${encodeURIComponent(conversationId)}`,
        { method: 'GET' },
      ),

    // Writes
    upsertConversation: async (req: ChatSyncUpsertRequest): Promise<ChatSyncResult<ChatSyncUpsertResponse>> =>
      doFetchJson<ChatSyncUpsertResponse>(
        `/api/sync/conversations/${encodeURIComponent(req.conversationId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            baseRevision: req.baseRevision,
            data: req.data,
          }),
        },
      ),

    deleteConversation: async (req: ChatSyncDeleteRequest): Promise<ChatSyncResult<ChatSyncDeleteResponse>> =>
      doFetchJson<ChatSyncDeleteResponse>(
        `/api/sync/conversations/${encodeURIComponent(req.conversationId)}`,
        {
          method: 'DELETE',
          // IMPORTANT: Next route handlers accept DELETE body; we rely on that.
          body: JSON.stringify({
            baseRevision: req.baseRevision,
          }),
        },
      ),
  };
}