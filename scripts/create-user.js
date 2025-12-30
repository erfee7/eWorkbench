// scripts/create-user.js

const { Client } = require('pg');
const { hash } = require('@node-rs/argon2');

const [, , usernameRaw, passwordRaw] = process.argv;

if (!usernameRaw || !passwordRaw) {
  console.error('Usage: node scripts/create-user.js <username> <password>');
  process.exit(1);
}

const username = usernameRaw.trim();
const password = passwordRaw;

const url = process.env.PG_DATABASE_URL;
if (!url) {
  console.error('PG_DATABASE_URL not configured');
  process.exit(1);
}

const client = new Client({ connectionString: url });

(async () => {
  try {
    await client.connect();
    const passwordHash = await hash(password);

    const res = await client.query(
      `
        INSERT INTO auth_users (username, password_hash)
        VALUES ($1, $2)
        RETURNING id, username
      `,
      [username, passwordHash],
    );

    console.log('Created user:', res.rows[0]);
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});