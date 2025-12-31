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