import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { execute } from "../db";
import { resetDb } from "./helpers/resetDb";

// One Express app for the whole file, same rationale as auth.integration.test.ts.
const app = createApp();

beforeEach(async () => {
  await resetDb();
});

/** Signs up a brand-new user and returns an agent that carries their session cookie. */
async function newUser(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/signup").send({ email, password: "correcthorse" });
  return agent;
}

describe("POST /api/transactions", () => {
  test("creates a transaction with a valid payload", async () => {
    const alice = await newUser("post-valid@example.com");
    const res = await alice.post("/api/transactions").send({
      date: "2026-01-10",
      description: "Coffee shop",
      amount_cents: -450,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      date: "2026-01-10",
      description: "Coffee shop",
      amount_cents: -450,
      // No category on the request -> the schema's default, not a 500.
      category: "Uncategorized",
      category_source: "manual",
    });
    expect(res.body.id).toEqual(expect.any(Number));
  });

  test("accepts an explicit category", async () => {
    const alice = await newUser("post-category@example.com");
    const res = await alice.post("/api/transactions").send({
      date: "2026-01-10",
      description: "Groceries run",
      amount_cents: -8000,
      category: "Groceries",
    });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe("Groceries");
  });

  test("rejects a missing amount with a field error, not a 500", async () => {
    const alice = await newUser("post-missing-amount@example.com");
    const res = await alice.post("/api/transactions").send({
      date: "2026-01-10",
      description: "No amount",
    });
    expect(res.status).toBe(400);
    expect(res.body.fields.amount_cents).toBeTruthy();
  });

  test("rejects a zero amount", async () => {
    const alice = await newUser("post-zero-amount@example.com");
    const res = await alice.post("/api/transactions").send({
      date: "2026-01-10",
      description: "Zero",
      amount_cents: 0,
    });
    expect(res.status).toBe(400);
  });

  test("rejects a malformed date", async () => {
    const alice = await newUser("post-bad-date@example.com");
    const res = await alice.post("/api/transactions").send({
      date: "not-a-date",
      description: "Bad date",
      amount_cents: -100,
    });
    expect(res.status).toBe(400);
    expect(res.body.fields.date).toBeTruthy();
  });

  test("rejects a future-dated transaction", async () => {
    const alice = await newUser("post-future-date@example.com");
    const res = await alice.post("/api/transactions").send({
      date: "2099-01-01",
      description: "From the future",
      amount_cents: -100,
    });
    expect(res.status).toBe(400);
  });

  test("requires a session", async () => {
    const res = await request(app).post("/api/transactions").send({
      date: "2026-01-10",
      description: "Anonymous",
      amount_cents: -100,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/transactions/import", () => {
  function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      date: "2026-01-05",
      description: "Imported row",
      amount_cents: -1200,
      category: "Groceries",
      ...overrides,
    };
  }

  test("imports a batch of valid rows and reports an accurate count", async () => {
    const alice = await newUser("import-valid@example.com");
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ description: `Row ${i}`, amount_cents: -(100 + i) })
    );

    const res = await alice.post("/api/transactions/import").send({ rows });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 5, skipped: [], duplicates: [] });

    const list = await alice.get("/api/transactions");
    expect(list.body.total).toBe(5);
  });

  test("skips invalid rows individually with a reason, without failing the whole import", async () => {
    const alice = await newUser("import-partial@example.com");
    const rows = [
      row({ description: "Good row" }),
      { date: "bad-date", description: "Bad row", amount_cents: -100 },
    ];

    const res = await alice.post("/api/transactions/import").send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].row).toBe(2);
    expect(res.body.skipped[0].reason).toMatch(/date/i);
  });

  test("flags a duplicate (same date, amount, and normalized description) but still imports it", async () => {
    const alice = await newUser("import-duplicate@example.com");
    await alice
      .post("/api/transactions")
      .send({ date: "2026-02-01", description: "WALMART #4521", amount_cents: -5000 });

    const res = await alice.post("/api/transactions/import").send({
      rows: [row({ date: "2026-02-01", description: "Walmart #7788", amount_cents: -5000 })],
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.duplicates).toHaveLength(1);
  });

  test("rejects an import payload with no rows array", async () => {
    const alice = await newUser("import-shape@example.com");
    const res = await alice.post("/api/transactions/import").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/transactions/import — 1,000-row cap", () => {
  function makeRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      date: "2026-01-01",
      description: `Bulk row ${i}`,
      amount_cents: -(100 + (i % 500)),
    }));
  }

  test(
    "accepts exactly 999 rows",
    async () => {
      const alice = await newUser("cap-999@example.com");
      const res = await alice.post("/api/transactions/import").send({ rows: makeRows(999) });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(999);
    },
    20_000
  );

  test(
    "accepts exactly 1,000 rows",
    async () => {
      const alice = await newUser("cap-1000@example.com");
      const res = await alice.post("/api/transactions/import").send({ rows: makeRows(1000) });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1000);
    },
    20_000
  );

  test("rejects 1,001 rows before importing any of them", async () => {
    const alice = await newUser("cap-1001@example.com");
    const res = await alice.post("/api/transactions/import").send({ rows: makeRows(1001) });
    expect(res.status).toBe(400);

    const list = await alice.get("/api/transactions");
    expect(list.body.total).toBe(0);
  });
});

describe("PATCH /api/transactions/:id", () => {
  test("updates a transaction's fields", async () => {
    const alice = await newUser("patch-update@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "Original", amount_cents: -500 });

    const res = await alice
      .patch(`/api/transactions/${created.body.id}`)
      .send({ description: "Updated", amount_cents: -600 });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Updated");
    expect(res.body.amount_cents).toBe(-600);
  });

  test("teaches the merchant cache when a category is manually corrected", async () => {
    const alice = await newUser("patch-teach-cache@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "Trader Joes #12", amount_cents: -3000 });

    await alice
      .patch(`/api/transactions/${created.body.id}`)
      .send({ category: "Groceries" })
      .expect(200);

    const cache = await execute("SELECT category FROM merchant_category_cache WHERE merchant_key = ?", [
      "trader joes",
    ]);
    expect((cache.rows[0] as unknown as { category: string } | undefined)?.category).toBe("Groceries");
  });

  test("returns 400 when the patch body has no recognized fields", async () => {
    const alice = await newUser("patch-empty@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "X", amount_cents: -100 });

    const res = await alice.patch(`/api/transactions/${created.body.id}`).send({});
    expect(res.status).toBe(400);
  });

  test("returns 404 for a transaction that doesn't exist", async () => {
    const alice = await newUser("patch-missing@example.com");
    const res = await alice.patch("/api/transactions/999999").send({ description: "Ghost" });
    expect(res.status).toBe(404);
  });

  test("two simultaneous PATCHes touching different fields both land -- neither is silently lost", async () => {
    const alice = await newUser("patch-concurrent@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "Original", amount_cents: -500, category: "Uncategorized" });
    const id = created.body.id;

    // Real concurrency, not simulated -- both requests fired at once. Each
    // PATCH's SQL only SETs the field(s) it was actually given, so two
    // requests touching disjoint fields should never be able to clobber
    // each other regardless of which one the server happens to process
    // first; this locks that invariant in.
    const [descRes, catRes] = await Promise.all([
      alice.patch(`/api/transactions/${id}`).send({ description: "Renamed concurrently" }),
      alice.patch(`/api/transactions/${id}`).send({ category: "Groceries" }),
    ]);

    expect(descRes.status).toBe(200);
    expect(catRes.status).toBe(200);

    const final = await alice.get(`/api/transactions?search=${encodeURIComponent("Renamed")}`);
    const row = final.body.rows[0];
    expect(row.description).toBe("Renamed concurrently");
    expect(row.category).toBe("Groceries");
    // The original amount, never touched by either request, must survive
    // both concurrent writes untouched.
    expect(row.amount_cents).toBe(-500);
  });
});

describe("DELETE /api/transactions/:id", () => {
  test("deletes a transaction — it's gone from the list afterward", async () => {
    const alice = await newUser("delete-basic@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "To delete", amount_cents: -100 });

    const del = await alice.delete(`/api/transactions/${created.body.id}`);
    expect(del.status).toBe(204);

    const list = await alice.get("/api/transactions");
    expect(list.body.rows).toEqual([]);
  });

  test("deleting the same transaction twice 404s the second time", async () => {
    const alice = await newUser("delete-twice@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "Once", amount_cents: -100 });

    await alice.delete(`/api/transactions/${created.body.id}`).expect(204);
    const second = await alice.delete(`/api/transactions/${created.body.id}`);
    expect(second.status).toBe(404);
  });

  test("returns 404 for a transaction that never existed", async () => {
    const alice = await newUser("delete-missing@example.com");
    const res = await alice.delete("/api/transactions/999999");
    expect(res.status).toBe(404);
  });
});

describe("cross-user isolation on transactions", () => {
  test("PATCH by a different user 404s and leaves the transaction unchanged", async () => {
    const alice = await newUser("iso-patch-alice@example.com");
    const bob = await newUser("iso-patch-bob@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "Alice only", amount_cents: -700 });

    const res = await bob.patch(`/api/transactions/${created.body.id}`).send({ description: "Hacked" });
    expect(res.status).toBe(404);

    const aliceList = await alice.get("/api/transactions");
    expect(aliceList.body.rows[0].description).toBe("Alice only");
  });

  test("DELETE by a different user 404s and leaves the transaction intact", async () => {
    const alice = await newUser("iso-delete-alice@example.com");
    const bob = await newUser("iso-delete-bob@example.com");
    const created = await alice
      .post("/api/transactions")
      .send({ date: "2026-01-10", description: "Still here", amount_cents: -700 });

    const res = await bob.delete(`/api/transactions/${created.body.id}`);
    expect(res.status).toBe(404);

    const aliceList = await alice.get("/api/transactions");
    expect(aliceList.body.rows).toHaveLength(1);
  });
});
