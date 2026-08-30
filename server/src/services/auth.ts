import { db } from "../db.js";
import { nowISO } from "../lib/dates.js";
import {
  RESET_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../lib/auth.js";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export function findUserByEmail(email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function findUserById(id: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

function userCount(): number {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return count;
}

/**
 * Every table that used to be single-user has rows with no owner
 * (user_id IS NULL) from before login existed. The very first account ever
 * created inherits all of it, so nothing gets lost when login is turned on.
 * Anyone who signs up after that starts with a genuinely empty account.
 */
function claimLegacyDataIfFirstUser(userId: number) {
  if (userCount() !== 1) return;

  db.prepare("UPDATE transactions SET user_id = ? WHERE user_id IS NULL").run(userId);
  db.prepare("UPDATE goals SET user_id = ? WHERE user_id IS NULL").run(userId);

  const legacySettings = db
    .prepare("SELECT key, value FROM settings WHERE user_id IS NULL OR user_id = 0")
    .all() as { key: string; value: string | null }[];
  const upsert = db.prepare(
    "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  );
  for (const row of legacySettings) {
    upsert.run(userId, row.key, row.value);
  }
}

export async function createUser(email: string, password: string): Promise<User> {
  const password_hash = await hashPassword(password);
  const created_at = nowISO();
  const info = db
    .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
    .run(email, password_hash, created_at);
  const userId = info.lastInsertRowid as number;

  claimLegacyDataIfFirstUser(userId);

  return { id: userId, email, password_hash, created_at };
}

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = findUserByEmail(email);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? user : null;
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = generateToken();
  const created_at = nowISO();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(hashToken(token), userId, created_at, expiresAt);
  return { token, expiresAt };
}

export function getUserIdForSession(token: string): number | null {
  const row = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(hashToken(token)) as { user_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at <= nowISO()) return null;
  return row.user_id;
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function createPasswordResetToken(userId: number): string {
  const token = generateToken();
  const created_at = nowISO();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(hashToken(token), userId, created_at, expiresAt);
  return token;
}

/** Returns the user id the token belongs to, and marks it used — a reset
 *  link only ever works once. Returns null for missing/expired/used tokens. */
export function consumePasswordResetToken(token: string): number | null {
  const tokenHash = hashToken(token);
  const row = db
    .prepare("SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?")
    .get(tokenHash) as { user_id: number; expires_at: string; used_at: string | null } | undefined;
  if (!row || row.used_at || row.expires_at <= nowISO()) return null;

  db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?").run(
    nowISO(),
    tokenHash
  );
  return row.user_id;
}

export async function setPassword(userId: number, newPassword: string): Promise<void> {
  const password_hash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(password_hash, userId);
  // Log every other device out once the password changes.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
