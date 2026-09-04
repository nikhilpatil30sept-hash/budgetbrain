import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Runs before each test file's own imports are evaluated, so db.ts (and
// anything importing it) picks up an isolated database instead of the real
// local one. db.ts only actually opens a connection lazily on first use, so
// setting env vars here (before that first use) is safe regardless of when
// this file's own import of db.ts gets evaluated relative to these lines.
//
// This points at a real (unique, temp) SQLite file rather than the literal
// ":memory:" URL. libsql's local driver silently swaps in a brand-new
// connection after any interactive transaction (client.transaction(), used
// by withTransaction() in db.ts) — reopening a real file still sees
// everything already committed to it, but reopening ":memory:" gets a
// second, genuinely empty database, quietly losing every table. A real
// temp file sidesteps that entirely while staying just as isolated and
// just as disposable.
const tmpDbPath = path.join(os.tmpdir(), `budgetbrain-test-${randomUUID()}.db`);
process.env.DATABASE_PATH = tmpDbPath;
process.env.NODE_ENV = "test";

const { initDb } = await import("./src/db.js");
await initDb();

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(tmpDbPath + suffix);
    } catch {
      // already gone / never created — fine either way
    }
  }
});
