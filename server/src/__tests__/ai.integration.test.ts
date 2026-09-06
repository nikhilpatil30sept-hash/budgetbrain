import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { execute } from "../db";
import { resetDb } from "./helpers/resetDb";

// One Express app for the whole file, same rationale as the other
// integration suites.
const app = createApp();

const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;

beforeEach(async () => {
  await resetDb();
  // callGemini bails out immediately with no_key if this isn't set — it's
  // never sent anywhere real since fetch itself is mocked per-test below.
  process.env.GEMINI_API_KEY = "fake-test-key";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.GEMINI_API_KEY = originalKey;
});

/** Signs up a brand-new user and returns an agent that carries their session cookie. */
async function newUser(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/signup").send({ email, password: "correcthorse" });
  return agent;
}

async function addTx(
  agent: Awaited<ReturnType<typeof newUser>>,
  description: string,
  amount_cents: number,
  date = "2026-01-15"
) {
  const res = await agent.post("/api/transactions").send({ date, description, amount_cents });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Bijective base-26 letters (A, B, ... Z, AA, AB, ...) — guarantees distinct,
 * digit-free merchant keys so every row lands in its own batch item. */
function letters(n: number): string {
  let s = "";
  n += 1;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/** Bulk-creates `count` Uncategorized transactions with distinct merchants via the import endpoint. */
async function importDistinctMerchants(agent: Awaited<ReturnType<typeof newUser>>, count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    date: "2026-01-15",
    description: `Merchant ${letters(i)} Store`,
    amount_cents: -1000 - i,
  }));
  const res = await agent.post("/api/transactions/import").send({ rows });
  expect(res.status).toBe(200);
  expect(res.body.imported).toBe(count);
}

function geminiSuccessResponse(category: string) {
  const entries = Array.from({ length: 100 }, (_, i) => ({ i, category }));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(entries) }] } }],
    }),
  } as unknown as Response;
}

function mockFetchAlwaysSucceeds(category = "Shopping") {
  const fetchMock = vi.fn().mockResolvedValue(geminiSuccessResponse(category));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Like mockFetchAlwaysSucceeds, but resolves after a short delay — used
 * where a test needs the run to still be "running" a moment later. */
function mockFetchSucceedsAfterDelay(category: string, delayMs: number) {
  const fetchMock = vi.fn().mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(geminiSuccessResponse(category)), delayMs))
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Waits for a background categorization run to finish, polling the status
 * endpoint at roughly the same cadence the real UI uses (~1s) — the app's
 * own rate limiter (300 req/min on /api) is sized for that, not tight
 * polling, and a fast test-only interval would burn through it and start
 * getting 429s instead of real responses. */
async function waitForDone(agent: Awaited<ReturnType<typeof newUser>>, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    const res = await agent.get("/api/categorize/status");
    if (res.body.status === "done") return res.body;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`categorization run did not finish within ${timeoutMs}ms (last: ${JSON.stringify(res.body)})`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("POST /api/categorize — starts and reports progress through to completion", () => {
  test("a small run transitions from running/done and finishes with accurate counts", async () => {
    const alice = await newUser("ai-progress@example.com");
    await addTx(alice, "Alpha Bakery", -1200);
    await addTx(alice, "Bravo Cinema", -3400);
    await addTx(alice, "Charlie Garage", -5600);

    mockFetchAlwaysSucceeds("Shopping");

    const start = await alice.post("/api/categorize");
    expect(start.status).toBe(202);
    expect(start.body.run_id).toEqual(expect.any(String));

    const immediate = await alice.get("/api/categorize/status");
    expect(immediate.body.run_id).toBe(start.body.run_id);
    expect(["running", "done"]).toContain(immediate.body.status);

    const final = await waitForDone(alice);
    expect(final.run_id).toBe(start.body.run_id);
    expect(final.total_transactions).toBe(3);
    expect(final.batches_total).toBe(1);
    expect(final.batches_done).toBe(1);
    expect(final.batches_skipped).toBe(0);
    expect(final.ai_count).toBe(3);
    expect(final.cached_count).toBe(0);
    expect(final.fallback_count).toBe(0);
    expect(final.errors).toEqual([]);
    expect(final.finished_at).toEqual(expect.any(String));

    const rowsResult = await execute("SELECT category, category_source FROM transactions");
    const rows = rowsResult.rows as unknown as { category: string; category_source: string }[];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.category).toBe("Shopping");
      expect(row.category_source).toBe("ai");
    }
  });

  test("returns 409 if a run is already in progress, and requires a session", async () => {
    const alice = await newUser("ai-conflict@example.com");
    await addTx(alice, "Delta Diner", -900);
    // A short artificial delay keeps the run "running" long enough for the
    // second request below to reliably observe the conflict.
    mockFetchSucceedsAfterDelay("Dining", 300);

    await alice.post("/api/categorize");
    const conflict = await alice.post("/api/categorize");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBeTruthy();

    await waitForDone(alice);

    const anon = await request(app).post("/api/categorize");
    expect(anon.status).toBe(401);
  });
});

describe("POST /api/categorize — batch sizing", () => {
  test("a small volume (under one batch) reports batches_total = 1", async () => {
    const alice = await newUser("ai-batch-small@example.com");
    for (let i = 0; i < 5; i++) {
      await addTx(alice, `Merchant ${letters(i)} Shop`, -500 - i);
    }
    mockFetchAlwaysSucceeds("Other");

    await alice.post("/api/categorize");
    const final = await waitForDone(alice);

    expect(final.total_transactions).toBe(5);
    expect(final.batches_total).toBe(1);
    expect(final.ai_count).toBe(5);
  });

  test(
    "a large volume (over 40 distinct merchants) splits into two batches",
    async () => {
      const alice = await newUser("ai-batch-large@example.com");
      await importDistinctMerchants(alice, 41);
      mockFetchAlwaysSucceeds("Other");

      await alice.post("/api/categorize");
      const final = await waitForDone(alice, 15000);

      expect(final.total_transactions).toBe(41);
      expect(final.batches_total).toBe(2);
      expect(final.batches_done).toBe(2);
      expect(final.batches_skipped).toBe(0);
      expect(final.ai_count).toBe(41);
    },
    20000
  );
});

describe("POST /api/categorize — merchant memory cache", () => {
  test("a repeated merchant hits the cache instead of calling Gemini again", async () => {
    const alice = await newUser("ai-cache@example.com");
    await addTx(alice, "Costco Warehouse", -8000);

    const fetchMock = mockFetchAlwaysSucceeds("Shopping");

    await alice.post("/api/categorize");
    const firstRun = await waitForDone(alice);
    expect(firstRun.batches_total).toBe(1);
    expect(firstRun.cached_count).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cacheRow = await execute(
      "SELECT category FROM merchant_category_cache WHERE merchant_key = ?",
      ["costco warehouse"]
    );
    expect((cacheRow.rows[0] as unknown as { category: string }).category).toBe("Shopping");

    // Same merchant, digits added — normalizes to the same key, so this
    // should be resolved from the cache with zero additional fetch calls.
    await addTx(alice, "Costco Warehouse #4521", -8500);
    await alice.post("/api/categorize");
    const secondRun = await waitForDone(alice);

    expect(secondRun.batches_total).toBe(0);
    expect(secondRun.cached_count).toBe(1);
    expect(secondRun.ai_count).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no new call

    const rowsResult = await execute(
      "SELECT description, category, category_source FROM transactions WHERE description LIKE ?",
      ["%#4521%"]
    );
    const row = rowsResult.rows[0] as unknown as { category: string; category_source: string };
    expect(row.category).toBe("Shopping");
    expect(row.category_source).toBe("cache");
  });
});

describe("POST /api/categorize — recovering from a mid-run Gemini failure", () => {
  test(
    "a failure partway through skips the rest without corrupting run state, and a re-run recovers",
    async () => {
      const alice = await newUser("ai-failure@example.com");
      await importDistinctMerchants(alice, 41); // forces exactly 2 batches

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(geminiSuccessResponse("Shopping")) // batch 1 succeeds
        .mockResolvedValue({ ok: false, status: 403 } as Response); // batch 2 fails (non-retryable)
      global.fetch = fetchMock as unknown as typeof fetch;

      await alice.post("/api/categorize");
      const failed = await waitForDone(alice, 15000);

      expect(failed.status).toBe("done");
      expect(failed.batches_done).toBe(1);
      expect(failed.batches_skipped).toBe(1);
      expect(failed.ai_count).toBe(40);
      expect(failed.fallback_count).toBe(0);
      expect(failed.errors.length).toBeGreaterThan(0);

      const remainingResult = await execute(
        "SELECT COUNT(*) AS n FROM transactions WHERE category = 'Uncategorized'"
      );
      expect((remainingResult.rows[0] as unknown as { n: number }).n).toBe(1);

      // Recovery: run state isn't stuck, so a fresh run can start immediately.
      mockFetchAlwaysSucceeds("Shopping");
      const retry = await alice.post("/api/categorize");
      expect(retry.status).toBe(202);

      const recovered = await waitForDone(alice, 15000);
      expect(recovered.status).toBe("done");
      expect(recovered.total_transactions).toBe(1);
      expect(recovered.ai_count).toBe(1);

      const stillUncategorizedResult = await execute(
        "SELECT COUNT(*) AS n FROM transactions WHERE category = 'Uncategorized'"
      );
      expect((stillUncategorizedResult.rows[0] as unknown as { n: number }).n).toBe(0);
    },
    30000
  );
});

describe("POST /api/flags/recompute — anomaly write-back", () => {
  test("flags a transaction exceeding 30% of monthly income, leaves smaller ones alone", async () => {
    const alice = await newUser("ai-anomaly@example.com");
    await alice.put("/api/settings").send({ monthly_income_cents: 100000 }); // $1,000/mo -> 30% = $300

    const bigId = await addTx(alice, "Big Shopping Spree", -40000, "2026-02-01"); // $400 > $300
    const smallId = await addTx(alice, "Regular Groceries", -1000, "2026-02-02"); // $10, well under

    const res = await alice.post("/api/flags/recompute");
    expect(res.status).toBe(200);
    expect(res.body.flagged_count).toBe(1);

    const rowsResult = await execute(
      "SELECT id, flagged, flag_reason FROM transactions WHERE id IN (?, ?)",
      [bigId, smallId]
    );
    const rows = rowsResult.rows as unknown as { id: number; flagged: number; flag_reason: string | null }[];
    const big = rows.find((r) => r.id === bigId)!;
    const small = rows.find((r) => r.id === smallId)!;

    expect(big.flagged).toBe(1);
    expect(big.flag_reason).toMatch(/30%/);
    expect(small.flagged).toBe(0);
    expect(small.flag_reason).toBeNull();
  });

  test("a dismissed flag stays dismissed across a later recompute", async () => {
    const alice = await newUser("ai-dismiss@example.com");
    await alice.put("/api/settings").send({ monthly_income_cents: 100000 });
    const bigId = await addTx(alice, "Another Big Purchase", -50000, "2026-02-01");

    await alice.post("/api/flags/recompute");
    const dismiss = await alice.patch(`/api/flags/${bigId}/dismiss`);
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.ok).toBe(true);

    const again = await alice.post("/api/flags/recompute");
    expect(again.status).toBe(200);
    expect(again.body.flagged_count).toBe(0);

    const rowResult = await execute(
      "SELECT flagged, flag_dismissed FROM transactions WHERE id = ?",
      [bigId]
    );
    const row = rowResult.rows[0] as unknown as { flagged: number; flag_dismissed: number };
    expect(row.flagged).toBe(0);
    expect(row.flag_dismissed).toBe(1);
  });

  test("requires a session", async () => {
    const res = await request(app).post("/api/flags/recompute");
    expect(res.status).toBe(401);
  });
});
