import { execute, withTransaction } from "../db.js";
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

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const result = await execute("SELECT * FROM users WHERE email = ?", [email]);
  return result.rows[0] as unknown as User | undefined;
}

export async function findUserById(id: number): Promise<User | undefined> {
  const result = await execute("SELECT * FROM users WHERE id = ?", [id]);
  return result.rows[0] as unknown as User | undefined;
}

async function userCount(): Promise<number> {
  const result = await execute("SELECT COUNT(*) AS count FROM users");
  return Number((result.rows[0] as unknown as { count: number }).count);
}

/**
 * Every table that used to be single-user has rows with no owner
 * (user_id IS NULL) from before login existed. The very first account ever
 * created inherits all of it, so nothing gets lost when login is turned on.
 * Anyone who signs up after that starts with a genuinely empty account.
 * Wrapped in one transaction (a correctness fix picked up while converting
 * this file to libsql — these 3 writes were not atomic together before).
 */
async function claimLegacyDataIfFirstUser(userId: number): Promise<void> {
  if ((await userCount()) !== 1) return;

  await withTransaction(async (tx) => {
    await tx.execute({
      sql: "UPDATE transactions SET user_id = ? WHERE user_id IS NULL",
      args: [userId],
    });
    await tx.execute({ sql: "UPDATE goals SET user_id = ? WHERE user_id IS NULL", args: [userId] });

    const legacySettings = await tx.execute({
      sql: "SELECT key, value FROM settings WHERE user_id IS NULL OR user_id = 0",
      args: [],
    });
    for (const row of legacySettings.rows as unknown as { key: string; value: string | null }[]) {
      await tx.execute({
        sql: "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
        args: [userId, row.key, row.value],
      });
    }
  });
}

export async function createUser(email: string, password: string): Promise<User> {
  const password_hash = await hashPassword(password);
  const created_at = nowISO();
  const info = await execute(
    "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
    [email, password_hash, created_at]
  );
  const userId = Number(info.lastInsertRowid);

  await claimLegacyDataIfFirstUser(userId);

  return { id: userId, email, password_hash, created_at };
}

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? user : null;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: string }> {
  const token = generateToken();
  const created_at = nowISO();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await execute(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [hashToken(token), userId, created_at, expiresAt]
  );
  return { token, expiresAt };
}

export async function getUserIdForSession(token: string): Promise<number | null> {
  const result = await execute(
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    [hashToken(token)]
  );
  const row = result.rows[0] as unknown as { user_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at <= nowISO()) return null;
  return row.user_id;
}

export async function deleteSession(token: string): Promise<void> {
  await execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

export async function createPasswordResetToken(userId: number): Promise<string> {
  const token = generateToken();
  const created_at = nowISO();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await execute(
    "INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [hashToken(token), userId, created_at, expiresAt]
  );
  return token;
}

/** Returns the user id the token belongs to, and marks it used — a reset
 *  link only ever works once. Returns null for missing/expired/used tokens. */
export async function consumePasswordResetToken(token: string): Promise<number | null> {
  const tokenHash = hashToken(token);
  const result = await execute(
    "SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?",
    [tokenHash]
  );
  const row = result.rows[0] as unknown as
    | { user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || row.expires_at <= nowISO()) return null;

  await execute("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?", [
    nowISO(),
    tokenHash,
  ]);
  return row.user_id;
}

export async function setPassword(userId: number, newPassword: string): Promise<void> {
  const password_hash = await hashPassword(newPassword);
  await execute("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash, userId]);
  // Log every other device out once the password changes.
  await execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
}
