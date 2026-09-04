import { batch } from "../../db.js";

/**
 * Wipes all app data between tests while keeping the (already-migrated)
 * schema in place. Cheaper than recreating the in-memory database for every
 * single test, and the auth integration suite needs a clean slate each time
 * — e.g. "the very first account claims legacy data" only means anything if
 * the users table is actually empty beforehand.
 *
 * Deletion order matters: children before parents, since foreign_keys = ON.
 * Runs as one batch so a failure partway through never leaves the tables
 * partially wiped for the next test to trip over.
 */
export async function resetDb(): Promise<void> {
  await batch([
    { sql: "DELETE FROM sessions" },
    { sql: "DELETE FROM password_reset_tokens" },
    { sql: "DELETE FROM settings" },
    { sql: "DELETE FROM goals" },
    { sql: "DELETE FROM transactions" },
    { sql: "DELETE FROM users" },
    { sql: "DELETE FROM merchant_category_cache" },
    { sql: "DELETE FROM suggestions_cache" },
  ]);
}
