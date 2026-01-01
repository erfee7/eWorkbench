-- docker/pg/init/02-auth-schema.sql

-- Admin-managed credential users for Auth.js Credentials provider.
-- Kept separate from upstream Prisma usage.

CREATE TABLE IF NOT EXISTS auth_users (
  id            uuid        NOT NULL DEFAULT uuid_generate_v4(),
  username      text        NOT NULL,
  password_hash text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  is_admin      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_auth_users_username
  ON auth_users (username);