// scripts/lib/repo.js

async function getAuthUserByUsername(client, username) {
  const res = await client.query(
    `
      SELECT
        id,
        username,
        is_active,
        is_admin,
        created_at,
        updated_at
      FROM auth_users
      WHERE username = $1
      LIMIT 1
    `,
    [username],
  );

  return res.rows[0] || null;
}

async function insertAuthUser(client, { username, passwordHash, isAdmin }) {
  const res = await client.query(
    `
      INSERT INTO auth_users (username, password_hash, is_admin)
      VALUES ($1, $2, $3)
      RETURNING id, username, is_active, is_admin, created_at
    `,
    [username, passwordHash, !!isAdmin],
  );

  return res.rows[0];
}

async function updateAuthUserPassword(client, { username, passwordHash }) {
  const res = await client.query(
    `
      UPDATE auth_users
      SET password_hash = $2, updated_at = now()
      WHERE username = $1
      RETURNING id, username, is_active, is_admin, updated_at
    `,
    [username, passwordHash],
  );

  return res.rows[0] || null;
}

async function setAuthUserActive(client, { username, isActive }) {
  const res = await client.query(
    `
      UPDATE auth_users
      SET is_active = $2, updated_at = now()
      WHERE username = $1
      RETURNING id, username, is_active, is_admin, updated_at
    `,
    [username, !!isActive],
  );

  return res.rows[0] || null;
}

async function setAuthUserAdmin(client, { username, isAdmin }) {
  const res = await client.query(
    `
      UPDATE auth_users
      SET is_admin = $2, updated_at = now()
      WHERE username = $1
      RETURNING id, username, is_active, is_admin, updated_at
    `,
    [username, !!isAdmin],
  );

  return res.rows[0] || null;
}

async function listAuthUsers(client) {
  const res = await client.query(
    `
      SELECT
        id,
        username,
        is_active,
        is_admin,
        created_at,
        updated_at
      FROM auth_users
      ORDER BY created_at ASC
    `,
  );

  return res.rows;
}

async function purgeSyncByUserId(client, userId) {
  const res = await client.query(
    `DELETE FROM sync_conversations WHERE user_id = $1`,
    [userId],
  );
  return res.rowCount || 0;
}

async function deleteAuthUserById(client, userId) {
  const res = await client.query(
    `DELETE FROM auth_users WHERE id = $1`,
    [userId],
  );
  return res.rowCount || 0;
}

module.exports = {
  getAuthUserByUsername,
  insertAuthUser,
  updateAuthUserPassword,
  setAuthUserActive,
  setAuthUserAdmin,
  listAuthUsers,
  purgeSyncByUserId,
  deleteAuthUserById,
};