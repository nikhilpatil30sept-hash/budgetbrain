import { db } from "../../db.js";

/**
 * Wipes all app data between tests while keeping the (already-migrated)
 * schema in place. Cheaper than recreating the in-memory database for every
 * single test, and the auth integration suite needs a clean slate each time
 * — e.g. "the very first account claims legacy data" only means anything if
 * the users table is actually empty beforehand.
 *
 * Deletion order matters: children before parents, since foreign_keys = ON.
 */
export function resetDb() {
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM password_reset_tokens;
    DELETE FROM settings;
    DELETE FROM goals;
    DELETE FROM transactions;
    DELETE FROM users;
    DELETE FROM merchant_category_cache;
    DELETE FROM suggestions_cache;
  `);
}
