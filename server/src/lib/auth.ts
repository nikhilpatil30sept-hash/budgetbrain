import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

// How long a login session lasts before you'd need to log in again.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// How long a "forgot password" link stays valid before it expires.
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** A random, URL-safe token to hand to the browser (cookie or reset link). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * We only ever store a hash of a session/reset token in the database, never
 * the raw value — the same reason passwords are hashed. A stolen copy of
 * the database on its own can't be used to log in as anyone.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}
