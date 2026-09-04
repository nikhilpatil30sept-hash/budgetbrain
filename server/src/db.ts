import { createClient, type Client, type InArgs } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// Same driver locally and in production (Turso), so there is only one code
// path to test and no risk of "works locally, breaks on Turso" drift.
// Priority: TURSO_DATABASE_URL (production) > a local `file:` URL derived
// from DATABASE_PATH > the default local data file. DATABASE_PATH=":memory:"
// (set by vitest.setup.ts) uses libSQL's in-memory engine for tests.
function resolveDbUrl(): string {
  if (process.env.TURSO_DATABASE_URL) {
    return process.env.TURSO_DATABASE_URL;
  }
  const dbPath = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "budgetbrain.db");
  if (dbPath === ":memory:") {
    return ":memory:";
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return `file:${dbPath}`;
}

// The client is created lazily (on first actual use), not at module load
// time. This matters for tests: vitest.setup.ts sets DATABASE_PATH=":memory:"
// as a plain top-level statement, and if db.ts eagerly built the client at
// import time, ES module import hoisting could evaluate that before the env
// var is set, or (as found while converting this file) an eagerly-created
// client can otherwise end up resolved before the intended env is in effect.
// Deferring creation until initDb()/execute() actually run sidesteps all of
// that — by then, whichever setup code needed to run first already has.
let _client: Client | null = null;
function getClient(): Client {
  if (!_client) {
    _client = createClient({
      url: resolveDbUrl(),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

function isLocalFile(): boolean {
  return !process.env.TURSO_DATABASE_URL && process.env.DATABASE_PATH !== ":memory:";
}

export interface Statement {
  sql: string;
  args?: InArgs;
}

/** Run a single statement. */
export async function execute(sql: string, args: InArgs = []) {
  return getClient().execute({ sql, args });
}

/**
 * Run a fixed, known-upfront list of statements atomically. Use this when
 * every statement is decided before the first one runs (migrations, wiping
 * a set of tables, a prepare-once/insert-many loop).
 */
export async function batch(statements: Statement[]) {
  return getClient().batch(
    statements.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    "write"
  );
}

/**
 * Run statements whose contents depend on per-row logic decided along the
 * way (a duplicate check before each insert, a conditional extra write, a
 * read-then-batch-write). Commits once `fn` resolves; rolls back and
 * rethrows on any error so nothing is left half-applied.
 */
export async function withTransaction<T>(
  fn: (tx: { execute: (stmt: Statement) => ReturnType<typeof execute> }) => Promise<T>
): Promise<T> {
  const tx = await getClient().transaction("write");
  try {
    const result = await fn({
      execute: (stmt) => tx.execute({ sql: stmt.sql, args: stmt.args ?? [] }),
    });
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// Sequential migrations keyed off PRAGMA user_version. Add new migrations at
// the end of the array only; never edit an applied one. Each migration is a
// list of individual statements (no semicolon-joined blocks) so it can run
// as one atomic batch() call together with the version bump.
const MIGRATIONS: Statement[][] = [
  [
    {
      sql: `CREATE TABLE transactions (
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
      )`,
    },
    { sql: "CREATE INDEX idx_transactions_date ON transactions(date)" },
    { sql: "CREATE INDEX idx_transactions_category ON transactions(category)" },
    {
      sql: `CREATE TABLE merchant_category_cache (
        merchant_key TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      )`,
    },
    {
      sql: `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
    },
    { sql: "INSERT INTO settings (key, value) VALUES ('monthly_income_cents', NULL)" },
    { sql: "INSERT INTO settings (key, value) VALUES ('currency_symbol', '$')" },
    {
      sql: `CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        target_cents INTEGER NOT NULL,
        deadline TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    },
    {
      sql: `CREATE TABLE suggestions_cache (
        month TEXT NOT NULL,
        data_hash TEXT NOT NULL,
        suggestions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (month, data_hash)
      )`,
    },
  ],
  [
    // Login/signup: each person gets their own account and their own private
    // data. Existing rows (created back when the app was single-user) have no
    // user_id yet; the signup route claims them for the very first account
    // created, so nothing gets lost.
    {
      sql: `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    },
    {
      sql: `CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    },
    { sql: "CREATE INDEX idx_sessions_user ON sessions(user_id)" },
    {
      sql: `CREATE TABLE password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      )`,
    },
    { sql: "CREATE INDEX idx_reset_tokens_user ON password_reset_tokens(user_id)" },
    { sql: "ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id)" },
    { sql: "CREATE INDEX idx_transactions_user ON transactions(user_id)" },
    { sql: "ALTER TABLE goals ADD COLUMN user_id INTEGER REFERENCES users(id)" },
    { sql: "CREATE INDEX idx_goals_user ON goals(user_id)" },
    // settings was a single global key/value table; it becomes one row-set
    // per user. SQLite can't alter a primary key in place, so the table is
    // recreated here rather than altered.
    {
      sql: `CREATE TABLE settings_new (
        user_id INTEGER NOT NULL REFERENCES users(id),
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )`,
    },
    { sql: "DROP TABLE settings" },
    { sql: "ALTER TABLE settings_new RENAME TO settings" },
  ],
];

/**
 * Applies any migrations newer than the highest version recorded in
 * schema_migrations. Must be awaited before the server starts accepting
 * requests (called from index.ts).
 *
 * This originally used PRAGMA user_version (simpler, no extra table) — that
 * works fine locally, but Turso's remote server rejects the write form
 * ("PRAGMA user_version = N") outright: "SQL not allowed statement". A
 * plain table tracking applied versions works identically everywhere
 * (local file, local memory, and remote Turso), so it replaces user_version
 * entirely rather than branching behavior by environment.
 *
 * Each migration's statements + its own version-row insert commit as one
 * atomic batch(), so a failure partway through never leaves a migration
 * recorded as applied without its matching schema change.
 */
export async function initDb(): Promise<void> {
  await execute("PRAGMA foreign_keys = ON");
  if (isLocalFile()) {
    // WAL mode is a local-file-only perf setting; not meaningful (and not
    // guaranteed supported) over a remote libsql:// connection to Turso.
    await execute("PRAGMA journal_mode = WAL");
  }

  await execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
  );
  const versionResult = await execute("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations");
  const current = Number((versionResult.rows[0] as unknown as { version: number })?.version ?? 0);

  for (let v = current; v < MIGRATIONS.length; v++) {
    await batch([
      ...MIGRATIONS[v],
      { sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", args: [v + 1, new Date().toISOString()] },
    ]);
  }
}
