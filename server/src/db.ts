import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "budgetbrain.db"));
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
