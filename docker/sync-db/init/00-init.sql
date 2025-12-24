-- docker/sync-db/init/00-init.sql

-- Safe minimal init. No schema decisions yet.
-- Helpful later if you want UUIDs, etc.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";