// src/server/auth/authTypes.ts

export type AuthUserId = string; // uuid string

export interface AuthUserRow {
  id: AuthUserId;
  username: string;
  passwordHash: string;
  isActive: boolean;

  // Prepared for future authorization features (no functional use yet).
  isAdmin: boolean;
}