-- docker/pg/init/01-sync-schema.sql

-- Per-(user_id, conversation_id) monotonic revision + tombstone delete
CREATE TABLE IF NOT EXISTS sync_conversations (
  user_id         text        NOT NULL,
  conversation_id text        NOT NULL,
  revision        bigint      NOT NULL,
  deleted         boolean     NOT NULL DEFAULT false,
  data            jsonb       NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_conversations_user_updated_at
  ON sync_conversations (user_id, updated_at DESC);