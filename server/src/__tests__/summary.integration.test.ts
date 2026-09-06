import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { execute } from "../db";
import { resetDb } from "./helpers/resetDb";
import { trailingMonths, todayISO } from "../lib/dates";

// One Express app for the whole file, same rationale as the other
// integration suites.
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

async function addTx(
  agent: Awaited<ReturnType<typeof newUser>>,
  date: string,
  description: string,
  amount_cents: number,
  category?: string
) {
  const res = await agent.post("/api/transactions").send({ date, description, amount_cents, category });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("GET /api/summary — aggregation totals", () => {
  test("totals, by-category, and flagged count match hand-calculated values", async () => {
    const alice = await newUser("summary-totals@example.com");

    // Income (positive, category "Income" — excluded from by_category, included in income_cents).
    await addTx(alice, "2026-03-05", "Paycheck", 300000, "Income");
    // Expenses across two categories.
    await addTx(alice, "2026-03-06", "Groceries run", -12000, "Groceries");
    await addTx(alice, "2026-03-10", "More groceries", -8000, "Groceries");
    await addTx(alice, "2026-03-12", "Movie night", -3500, "Entertainment");
    // A Transfers transaction — excluded from spent/income/net and by_category entirely.
    await addTx(alice, "2026-03-15", "Move to savings", -50000, "Transfers");
    // A transaction in a different month — must not leak into March's totals.
    await addTx(alice, "2026-02-20", "February coffee", -400, "Dining");

    const flaggedId = await addTx(alice, "2026-03-18", "Suspicious charge", -9999, "Shopping");
    await execute("UPDATE transactions SET flagged = 1 WHERE id = ?", [flaggedId]);

    const res = await alice.get("/api/summary").query({ month: "2026-03" });
    expect(res.status).toBe(200);

    // spent = 12000 + 8000 + 3500 + 9999 (Transfers and the Feb row excluded)
    expect(res.body.spent_cents).toBe(33499);
    expect(res.body.income_cents).toBe(300000);
    expect(res.body.net_cents).toBe(300000 - 33499);
    expect(res.body.flagged_count).toBe(1);

    expect(res.body.by_category).toEqual([
      { category: "Groceries", spent_cents: 20000 },
      { category: "Shopping", spent_cents: 9999 },
      { category: "Entertainment", spent_cents: 3500 },
    ]);

    // The six-month series ends at March 2026 and should carry March's spend only.
    const expectedMonths = trailingMonths("2026-03", 6);
    expect(res.body.six_month_series.map((r: { month: string }) => r.month)).toEqual(expectedMonths);
    const march = res.body.six_month_series.find((r: { month: string }) => r.month === "2026-03");
    expect(march.spent_cents).toBe(33499);
    // February also falls inside the trailing 6-month window and carries its
    // own $4.00 (400 cents) from the "February coffee" row seeded above.
    const feb = res.body.six_month_series.find((r: { month: string }) => r.month === "2026-02");
    expect(feb.spent_cents).toBe(400);
    for (const row of res.body.six_month_series) {
      if (row.month !== "2026-03" && row.month !== "2026-02") expect(row.spent_cents).toBe(0);
    }
  });

  test("requires a session", async () => {
    const res = await request(app).get("/api/summary");
    expect(res.status).toBe(401);
  });

  test("rejects a malformed month", async () => {
    const alice = await newUser("summary-bad-month@example.com");
    const res = await alice.get("/api/summary").query({ month: "March-2026" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/summary — empty state", () => {
  test("a brand-new user with zero transactions gets sane zeros, not errors", async () => {
    const alice = await newUser("summary-empty@example.com");
    const res = await alice.get("/api/summary");

    expect(res.status).toBe(200);
    expect(res.body.spent_cents).toBe(0);
    expect(res.body.income_cents).toBe(0);
    expect(res.body.net_cents).toBe(0);
    expect(res.body.flagged_count).toBe(0);
    expect(res.body.by_category).toEqual([]);

    const currentMonth = todayISO().slice(0, 7);
    expect(res.body.month).toBe(currentMonth);
    const expectedMonths = trailingMonths(currentMonth, 6);
    expect(res.body.six_month_series).toEqual(
      expectedMonths.map((m) => ({ month: m, spent_cents: 0 }))
    );
  });
});

describe("GET /api/summary — month-boundary edge cases", () => {
  test("transactions right at the start and end of a month land in that month's bucket", async () => {
    const alice = await newUser("summary-boundary@example.com");

    // Last day of February — must NOT count toward March.
    await addTx(alice, "2026-02-28", "End of Feb", -1000, "Dining");
    // First day of March — must count toward March.
    await addTx(alice, "2026-03-01", "Start of March", -2000, "Dining");
    // Last day of March — must count toward March.
    await addTx(alice, "2026-03-31", "End of March", -3000, "Dining");
    // First day of April — must NOT count toward March.
    await addTx(alice, "2026-04-01", "Start of April", -4000, "Dining");

    const res = await alice.get("/api/summary").query({ month: "2026-03" });
    expect(res.status).toBe(200);
    expect(res.body.spent_cents).toBe(5000);
    expect(res.body.by_category).toEqual([{ category: "Dining", spent_cents: 5000 }]);
  });

  test("a year boundary (December to January) is handled correctly", async () => {
    const alice = await newUser("summary-year-boundary@example.com");

    await addTx(alice, "2025-12-31", "New Year's Eve dinner", -6000, "Dining");
    await addTx(alice, "2026-01-01", "New Year's Day brunch", -2500, "Dining");

    const decRes = await alice.get("/api/summary").query({ month: "2025-12" });
    expect(decRes.status).toBe(200);
    expect(decRes.body.spent_cents).toBe(6000);

    const janRes = await alice.get("/api/summary").query({ month: "2026-01" });
    expect(janRes.status).toBe(200);
    expect(janRes.body.spent_cents).toBe(2500);
  });
});
