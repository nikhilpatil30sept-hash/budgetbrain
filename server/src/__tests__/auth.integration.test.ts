import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { execute } from "../db";
import { createPasswordResetToken, findUserByEmail } from "../services/auth";
import { resetDb } from "./helpers/resetDb";

// One Express app for the whole file — cheap, and it's what the real
// process does too (a single long-lived app instance).
const app = createApp();

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/auth/signup", () => {
  test("creates an account, starts a session, and never leaks the password hash", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "Nick@Example.com", password: "correcthorse" });

    expect(res.status).toBe(201);
    // Email is normalized (trimmed + lowercased) by the schema.
    expect(res.body).toEqual({ id: expect.any(Number), email: "nick@example.com" });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^sid=/);
  });

  test("rejects a duplicate email with 409", async () => {
    await request(app).post("/api/auth/signup").send({ email: "dup@example.com", password: "correcthorse" });
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "dup@example.com", password: "anotherpassword" });
    expect(res.status).toBe(409);
  });

  test("rejects a too-short password with a field error, not a 500", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email: "short@example.com", password: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.fields).toBeTruthy();
  });

  test("rejects a malformed email", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "not-an-email", password: "correcthorse" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  test("logs in with correct credentials", async () => {
    await request(app).post("/api/auth/signup").send({ email: "login@example.com", password: "correcthorse" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@example.com", password: "correcthorse" });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("login@example.com");
  });

  test("a wrong password gets the same generic message as a nonexistent email", async () => {
    await request(app).post("/api/auth/signup").send({ email: "wrongpw@example.com", password: "correcthorse" });
    const wrongPw = await request(app)
      .post("/api/auth/login")
      .send({ email: "wrongpw@example.com", password: "not-the-password" });
    const noSuchUser = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@example.com", password: "whatever123" });

    expect(wrongPw.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPw.body.error).toBe(noSuchUser.body.error);
  });
});

describe("session lifecycle", () => {
  test("GET /api/auth/me is 401 with no session, 200 once logged in", async () => {
    const anon = await request(app).get("/api/auth/me");
    expect(anon.status).toBe(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email: "sess@example.com", password: "correcthorse" });
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("sess@example.com");
  });

  test("logging out clears the session — /me 401s again afterward", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email: "logout@example.com", password: "correcthorse" });
    await agent.post("/api/auth/logout").expect(204);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  test("a protected data route 401s anonymously and works once logged in", async () => {
    const anon = await request(app).get("/api/settings");
    expect(anon.status).toBe(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email: "data@example.com", password: "correcthorse" });
    const res = await agent.get("/api/settings");
    expect(res.status).toBe(200);
  });
});

describe("per-user data isolation", () => {
  test("two accounts never see each other's transactions", async () => {
    const alice = request.agent(app);
    const bob = request.agent(app);
    await alice.post("/api/auth/signup").send({ email: "alice@example.com", password: "correcthorse" });
    await bob.post("/api/auth/signup").send({ email: "bob@example.com", password: "correcthorse" });

    await alice
      .post("/api/transactions")
      .send({ date: "2026-01-15", description: "Alice's coffee", amount_cents: -450 })
      .expect(201);

    const bobList = await bob.get("/api/transactions");
    expect(bobList.status).toBe(200);
    expect(bobList.body.rows).toEqual([]);

    const aliceList = await alice.get("/api/transactions");
    expect(aliceList.body.rows).toHaveLength(1);
    expect(aliceList.body.rows[0].description).toBe("Alice's coffee");
  });
});

describe("legacy data claim", () => {
  test("pre-existing (ownerless) data is attached to the very first account, not later ones", async () => {
    await execute(
      "INSERT INTO transactions (date, description, amount_cents, created_at) VALUES (?, ?, ?, ?)",
      ["2026-01-01", "Legacy grocery run", -5000, new Date().toISOString()]
    );

    const first = request.agent(app);
    await first.post("/api/auth/signup").send({ email: "first@example.com", password: "correcthorse" });
    const firstList = await first.get("/api/transactions");
    expect(firstList.body.rows.map((r: { description: string }) => r.description)).toContain(
      "Legacy grocery run"
    );

    const second = request.agent(app);
    await second.post("/api/auth/signup").send({ email: "second@example.com", password: "correcthorse" });
    const secondList = await second.get("/api/transactions");
    expect(secondList.body.rows).toEqual([]);
  });

  // Regression test for a real bug: the writes that make up a legacy-data
  // claim (transactions, goals, and -- when there are any -- settings) used
  // to run as separate, independently-awaited statements, not one atomic
  // transaction. Under a race between simultaneous first signups -- or any
  // failure partway through -- that could leave the claim split across
  // tables (e.g. the transactions moved to the new account but the goal
  // didn't). Wrapping them all in withTransaction (server/src/db.ts) fixed
  // it; this locks that fix in.
  //
  // Only transactions and goals are seeded here: settings.user_id is
  // NOT NULL with a foreign key to users(id), so -- unlike transactions and
  // goals, whose user_id is nullable -- there is no way to construct an
  // ownerless settings row against the current schema (id 0 doesn't belong
  // to any real user, and the insert is correctly rejected by the FK
  // constraint). claimLegacyDataIfFirstUser's settings branch runs, it just
  // has nothing to claim, which is the correct behavior for a fresh account.
  test("a race between simultaneous first signups still claims legacy data atomically across tables -- never split, never duplicated", async () => {
    await execute(
      "INSERT INTO transactions (date, description, amount_cents, created_at) VALUES (?, ?, ?, ?)",
      ["2026-01-01", "Legacy grocery run", -5000, new Date().toISOString()]
    );
    await execute(
      "INSERT INTO goals (name, target_cents, deadline, created_at) VALUES (?, ?, ?, ?)",
      ["Legacy emergency fund", 100000, "2026-12-31", new Date().toISOString()]
    );

    // Real concurrency, not simulated -- several signups fired at once.
    // Which one (if any) ends up being "the first" is inherently racy and
    // not something this test controls or needs to; what the atomic
    // transaction guarantees, and what this test actually verifies, is
    // that however the race resolves, the claim across both tables lands
    // together -- never split between accounts.
    const emails = ["racer1@example.com", "racer2@example.com", "racer3@example.com"];
    await Promise.all(
      emails.map((email) => request(app).post("/api/auth/signup").send({ email, password: "correcthorse" }))
    );

    const txOwner = (
      await execute("SELECT user_id FROM transactions WHERE description = ?", ["Legacy grocery run"])
    ).rows[0] as unknown as { user_id: number | null };
    const goalOwner = (
      await execute("SELECT user_id FROM goals WHERE name = ?", ["Legacy emergency fund"])
    ).rows[0] as unknown as { user_id: number | null };

    if (txOwner.user_id === null) {
      // Nobody's count-of-users check ever landed on exactly 1 -- fine, as
      // long as it's consistently nobody, not a partial claim.
      expect(goalOwner.user_id).toBeNull();
    } else {
      expect(goalOwner.user_id).toBe(txOwner.user_id);
    }
  });
});

describe("forgot / reset password", () => {
  test("the response is identical whether or not the email has an account", async () => {
    await request(app).post("/api/auth/signup").send({ email: "reset@example.com", password: "correcthorse" });
    const known = await request(app).post("/api/auth/forgot-password").send({ email: "reset@example.com" });
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nosuchaccount@example.com" });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  test("a valid reset token sets a new password and logs the user straight in", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ email: "resetflow@example.com", password: "originalpw1" });
    const user = (await findUserByEmail("resetflow@example.com"))!;
    const token = await createPasswordResetToken(user.id);

    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "brandnewpw1" });
    expect(reset.status).toBe(200);
    expect(reset.headers["set-cookie"]?.[0]).toMatch(/^sid=/);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "resetflow@example.com", password: "originalpw1" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "resetflow@example.com", password: "brandnewpw1" });
    expect(newLogin.status).toBe(200);
  });

  test("an unrecognized reset token is rejected", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", password: "whatever123" });
    expect(res.status).toBe(400);
  });

  test("a reset token only works once", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ email: "onceonly@example.com", password: "originalpw1" });
    const user = (await findUserByEmail("onceonly@example.com"))!;
    const token = await createPasswordResetToken(user.id);

    const first = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword1" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "anotherpassword1" });
    expect(second.status).toBe(400);
  });
});
