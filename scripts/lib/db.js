// scripts/lib/db.js

const { Client } = require('pg');

function requirePgUrl() {
  const url = process.env.PG_DATABASE_URL;
  if (!url) {
    console.error('PG_DATABASE_URL not configured');
    process.exit(2);
  }
  return url;
}

async function withClient(fn) {
  const client = new Client({ connectionString: requirePgUrl() });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withTransaction(client, fn) {
  try {
    await client.query('BEGIN');
    const res = await fn();
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

module.exports = {
  withClient,
  withTransaction,
};