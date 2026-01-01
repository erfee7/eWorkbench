// src/server/auth/authRepo.ts

import { getAuthPgPool } from './authDb';
import type { AuthUserRow } from './authTypes';

export async function getUserByUsername(username: string): Promise<AuthUserRow | null> {
  const pool = getAuthPgPool();

  const res = await pool.query<AuthUserRow>(
    `
      SELECT
        id,
        username,
        password_hash AS "passwordHash",
        is_active AS "isActive",
        is_admin AS "isAdmin"
      FROM auth_users
      WHERE username = $1
      LIMIT 1
    `,
    [username],
  );

  return res.rows[0] ?? null;
}

/**
 * Fetch user by UUID (used for session validity checks).
 * Note: "valid session" requires: row exists AND isActive=true.
 */
export async function getUserById(userId: string): Promise<AuthUserRow | null> {
  const pool = getAuthPgPool();

  const res = await pool.query<AuthUserRow>(
    `
      SELECT
        id,
        username,
        password_hash AS "passwordHash",
        is_active AS "isActive",
        is_admin AS "isAdmin"
      FROM auth_users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  return res.rows[0] ?? null;
}

export async function updateUserPasswordHash(userId: string, passwordHash: string): Promise<boolean> {
  const pool = getAuthPgPool();

  const res = await pool.query(
    `
      UPDATE auth_users
      SET password_hash = $2
      WHERE id = $1
    `,
    [userId, passwordHash],
  );

  return res.rowCount === 1;
}