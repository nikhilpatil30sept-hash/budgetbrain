import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { resetDb } from "./helpers/resetDb";

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

describe("GET /api/settings", () => {
  test("returns default values for a brand-new user", async () => {
    const alice = await newUser("settings-defaults@example.com");
    const res = await alice.get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ monthly_income_cents: null, currency_symbol: "$" });
  });

  test("returns previously saved values", async () => {
    const alice = await newUser("settings-saved@example.com");
    await alice.put("/api/settings").send({ monthly_income_cents: 450000, currency_symbol: "€" });

    const res = await alice.get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ monthly_income_cents: 450000, currency_symbol: "€" });
  });

  test("requires a session", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/settings", () => {
  test("updates monthly income correctly", async () => {
    const alice = await newUser("settings-put-income@example.com");
    const res = await alice.put("/api/settings").send({ monthly_income_cents: 600000 });
    expect(res.status).toBe(200);
    expect(res.body.monthly_income_cents).toBe(600000);
    // Untouched field keeps its default.
    expect(res.body.currency_symbol).toBe("$");
  });

  test("updates currency symbol correctly", async () => {
    const alice = await newUser("settings-put-currency@example.com");
    const res = await alice.put("/api/settings").send({ currency_symbol: "£" });
    expect(res.status).toBe(200);
    expect(res.body.currency_symbol).toBe("£");
    expect(res.body.monthly_income_cents).toBeNull();
  });

  test("updates both fields in a single request", async () => {
    const alice = await newUser("settings-put-both@example.com");
    const res = await alice
      .put("/api/settings")
      .send({ monthly_income_cents: 350000, currency_symbol: "¥" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ monthly_income_cents: 350000, currency_symbol: "¥" });
  });

  test("can explicitly clear monthly income back to null", async () => {
    const alice = await newUser("settings-put-clear@example.com");
    await alice.put("/api/settings").send({ monthly_income_cents: 100000 });
    const res = await alice.put("/api/settings").send({ monthly_income_cents: null });
    expect(res.status).toBe(200);
    expect(res.body.monthly_income_cents).toBeNull();
  });

  test("an empty body is a no-op that returns the current settings unchanged", async () => {
    const alice = await newUser("settings-put-empty@example.com");
    await alice.put("/api/settings").send({ monthly_income_cents: 200000, currency_symbol: "€" });
    const res = await alice.put("/api/settings").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ monthly_income_cents: 200000, currency_symbol: "€" });
  });

  test("rejects a negative monthly income", async () => {
    const alice = await newUser("settings-put-negative-income@example.com");
    const res = await alice.put("/api/settings").send({ monthly_income_cents: -100 });
    expect(res.status).toBe(400);
    expect(res.body.fields.monthly_income_cents).toBeTruthy();
  });

  test("rejects an empty currency symbol", async () => {
    const alice = await newUser("settings-put-empty-currency@example.com");
    const res = await alice.put("/api/settings").send({ currency_symbol: "" });
    expect(res.status).toBe(400);
    expect(res.body.fields.currency_symbol).toBeTruthy();
  });

  test("rejects a currency symbol longer than 3 characters", async () => {
    const alice = await newUser("settings-put-long-currency@example.com");
    const res = await alice.put("/api/settings").send({ currency_symbol: "USDX" });
    expect(res.status).toBe(400);
    expect(res.body.fields.currency_symbol).toBeTruthy();
  });

  test("requires a session", async () => {
    const res = await request(app).put("/api/settings").send({ currency_symbol: "€" });
    expect(res.status).toBe(401);
  });
});

describe("settings isolation between users", () => {
  test("one user's saved settings never leak into another user's defaults", async () => {
    const alice = await newUser("settings-iso-alice@example.com");
    const bob = await newUser("settings-iso-bob@example.com");

    await alice.put("/api/settings").send({ monthly_income_cents: 999999, currency_symbol: "€" });

    const bobSettings = await bob.get("/api/settings");
    expect(bobSettings.body).toEqual({ monthly_income_cents: null, currency_symbol: "$" });

    const aliceSettings = await alice.get("/api/settings");
    expect(aliceSettings.body).toEqual({ monthly_income_cents: 999999, currency_symbol: "€" });
  });
});
