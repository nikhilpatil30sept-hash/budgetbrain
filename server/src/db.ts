import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// DATABASE_PATH lets tests (and eventually a real deploy) point at a
// throwaway file or an absolute path instead of the real local database.
const dbPath = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "budgetbrain.db");
if (dbPath !== ":memory:") {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Sequential migrations keyed off PRAGMA user_version. Add new migrations at
// the end of the array only; never edit an applied one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'Uncategorized',
    category_source TEXT NOT NULL DEFAULT 'manual',
    flagged INTEGER NOT NULL DEFAULT 0,
    flag_reason TEXT,
    flag_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_transactions_date ON transactions(date);
  CREATE INDEX idx_transactions_category ON transactions(category);

  CREATE TABLE merchant_category_cache (
    merchant_key TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  INSERT INTO settings (key, value) VALUES ('monthly_income_cents', NULL);
  INSERT INTO settings (key, value) VALUES ('currency_symbol', '$');

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    deadline TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE suggestions_cache (
    month TEXT NOT NULL,
    data_hash TEXT NOT NULL,
    suggestions TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (month, data_hash)
  );
  `,
  `
  -- Login/signup: each person gets their own account and their own private
  -- data. Existing rows (created back when the app was single-user) have no
  -- user_id yet; the signup route claims them for the very first account
  -- created, so nothing gets lost.
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX idx_reset_tokens_user ON password_reset_tokens(user_id);

  ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id);
  CREATE INDEX idx_transactions_user ON transactions(user_id);

  ALTER TABLE goals ADD COLUMN user_id INTEGER REFERENCES users(id);
  CREATE INDEX idx_goals_user ON goals(user_id);

  -- settings was a single global key/value table; it becomes one row-set
  -- per user. SQLite can't alter a primary key in place, so the table is
  -- recreated here rather than altered.
  CREATE TABLE settings_new (
    user_id INTEGER NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );
  DROP TABLE settings;
  ALTER TABLE settings_new RENAME TO settings;
  `,
];

function migrate() {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

migrate();
