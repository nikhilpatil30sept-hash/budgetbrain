// Runs before each test file's own imports are evaluated, so db.ts (and
// anything importing it) picks up an isolated in-memory database instead of
// the real local one. Also keeps auth rate-limiting out of the test suite's
// way — see the `skip` in routes/auth.ts.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";
