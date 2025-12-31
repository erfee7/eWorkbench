// scripts/lib/password.js

const crypto = require('crypto');
const { hash } = require('@node-rs/argon2');

const { promptHidden } = require('./prompt');
const { validatePassword } = require('./validate');
const { CliError } = require('./errors');

// Keep consistent with src/server/auth/password.ts
const ARGON2_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function generatePassword(len = 24) {
  // base64url: copy/paste-friendly. Slice for stable length.
  return crypto.randomBytes(48).toString('base64url').slice(0, len);
}

async function getPasswordInteractive() {
  const p1 = await promptHidden('Password: ');
  const p2 = await promptHidden('Confirm password: ');
  if (p1 !== p2)
    throw new CliError('passwords do not match', 1);
  return validatePassword(p1);
}

async function getPassword({ generate }) {
  if (generate) {
    const pw = generatePassword(24);
    return { password: pw, generated: true };
  }

  const pw = await getPasswordInteractive();
  return { password: pw, generated: false };
}

async function hashPassword(plain) {
  return hash(plain, ARGON2_OPTS);
}

module.exports = {
  getPassword,
  hashPassword,
};