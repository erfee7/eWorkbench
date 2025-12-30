// src/server/auth/password.ts

import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2 parameters:
 * - Kept modest for interactive login.
 * - Can be tuned based on your deployment CPU/memory.
 */
const ARGON2_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error('password is empty');
  return hash(plain, ARGON2_OPTS);
}

export async function verifyPasswordHash(hashString: string, plain: string): Promise<boolean> {
  if (!hashString || !plain) return false;
  try {
    return await verify(hashString, plain);
  } catch {
    // Treat malformed hashes as "no match"
    return false;
  }
}