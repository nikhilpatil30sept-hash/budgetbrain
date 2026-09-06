import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { addDaysISO, todayISO } from "../lib/dates";
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

const future = (days: number) => addDaysISO(todayISO(), days);

describe("GET /api/goals", () => {
  test("returns an empty list and zero velocity for a brand-new user", async () => {
    const alice = await newUser("goals-empty@example.com");
    const res = await alice.get("/api/goals");
    expect(res.status).toBe(200);
    expect(res.body.goals).toEqual([]);
    expect(res.body.velocity_weekly_cents).toBe(0);
  });

  test("lists a user's goals ordered by deadline, with computed stats attached", async () => {
    const alice = await newUser("goals-list@example.com");
    await alice.post("/api/goals").send({ name: "Later goal", target_cents: 50000, deadline: future(120) });
    await alice.post("/api/goals").send({ name: "Sooner goal", target_cents: 20000, deadline: future(30) });

    const res = await alice.get("/api/goals");
    expect(res.status).toBe(200);
    expect(res.body.goals).toHaveLength(2);
    expect(res.body.goals.map((g: { name: string }) => g.name)).toEqual(["Sooner goal", "Later goal"]);
    // Every goal in the list carries the computed stat fields, not just the raw row.
    for (const g of res.body.goals) {
      expect(g).toHaveProperty("saved_cents");
      expect(g).toHaveProperty("remaining_cents");
      expect(g).toHaveProperty("status");
    }
  });
});

describe("POST /api/goals", () => {
  test("creates a goal with valid data", async () => {
    const alice = await newUser("goals-create@example.com");
    const res = await alice
      .post("/api/goals")
      .send({ name: "Emergency fund", target_cents: 100000, deadline: future(180) });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Emergency fund",
      target_cents: 100000,
      saved_cents: 0,
      remaining_cents: 100000,
    });
    expect(res.body.id).toEqual(expect.any(Number));
  });

  test("rejects a zero target amount", async () => {
    const alice = await newUser("goals-zero-target@example.com");
    const res = await alice.post("/api/goals").send({ name: "Bad goal", target_cents: 0, deadline: future(30) });
    expect(res.status).toBe(400);
    expect(res.body.fields.target_cents).toBeTruthy();
  });

  test("rejects a negative target amount", async () => {
    const alice = await newUser("goals-negative-target@example.com");
    const res = await alice
      .post("/api/goals")
      .send({ name: "Bad goal", target_cents: -5000, deadline: future(30) });
    expect(res.status).toBe(400);
    expect(res.body.fields.target_cents).toBeTruthy();
  });

  test("rejects a missing name", async () => {
    const alice = await newUser("goals-missing-name@example.com");
    const res = await alice.post("/api/goals").send({ target_cents: 10000, deadline: future(30) });
    expect(res.status).toBe(400);
    expect(res.body.fields.name).toBeTruthy();
  });

  test("rejects a malformed deadline", async () => {
    const alice = await newUser("goals-bad-deadline@example.com");
    const res = await alice
      .post("/api/goals")
      .send({ name: "Bad deadline", target_cents: 10000, deadline: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.fields.deadline).toBeTruthy();
  });

  test("requires a session", async () => {
    const res = await request(app)
      .post("/api/goals")
      .send({ name: "Anonymous", target_cents: 10000, deadline: future(30) });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/goals/:id", () => {
  test("updates a goal's fields", async () => {
    const alice = await newUser("goals-patch@example.com");
    const created = await alice
      .post("/api/goals")
      .send({ name: "Original", target_cents: 10000, deadline: future(30) });

    const res = await alice
      .patch(`/api/goals/${created.body.id}`)
      .send({ name: "Renamed", target_cents: 20000 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
    expect(res.body.target_cents).toBe(20000);
  });

  test("returns 400 for an empty patch body", async () => {
    const alice = await newUser("goals-patch-empty@example.com");
    const created = await alice
      .post("/api/goals")
      .send({ name: "Original", target_cents: 10000, deadline: future(30) });

    const res = await alice.patch(`/api/goals/${created.body.id}`).send({});
    expect(res.status).toBe(400);
  });

  test("returns 404 for a goal that doesn't exist", async () => {
    const alice = await newUser("goals-patch-missing@example.com");
    const res = await alice.patch("/api/goals/999999").send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });

  test("cross-user: PATCH by a different user 404s and leaves the goal unchanged", async () => {
    const alice = await newUser("goals-patch-iso-alice@example.com");
    const bob = await newUser("goals-patch-iso-bob@example.com");
    const created = await alice
      .post("/api/goals")
      .send({ name: "Alice's goal", target_cents: 10000, deadline: future(30) });

    const res = await bob.patch(`/api/goals/${created.body.id}`).send({ name: "Hacked" });
    expect(res.status).toBe(404);

    const aliceList = await alice.get("/api/goals");
    expect(aliceList.body.goals[0].name).toBe("Alice's goal");
  });
});

describe("DELETE /api/goals/:id", () => {
  test("deletes a goal — it's gone from the list afterward", async () => {
    const alice = await newUser("goals-delete@example.com");
    const created = await alice
      .post("/api/goals")
      .send({ name: "To delete", target_cents: 10000, deadline: future(30) });

    const del = await alice.delete(`/api/goals/${created.body.id}`);
    expect(del.status).toBe(204);

    const list = await alice.get("/api/goals");
    expect(list.body.goals).toEqual([]);
  });

  test("returns 404 for a goal that never existed", async () => {
    const alice = await newUser("goals-delete-missing@example.com");
    const res = await alice.delete("/api/goals/999999");
    expect(res.status).toBe(404);
  });

  test("cross-user: DELETE by a different user 404s and leaves the goal intact", async () => {
    const alice = await newUser("goals-delete-iso-alice@example.com");
    const bob = await newUser("goals-delete-iso-bob@example.com");
    const created = await alice
      .post("/api/goals")
      .send({ name: "Still here", target_cents: 10000, deadline: future(30) });

    const res = await bob.delete(`/api/goals/${created.body.id}`);
    expect(res.status).toBe(404);

    const aliceList = await alice.get("/api/goals");
    expect(aliceList.body.goals).toHaveLength(1);
  });
});

describe("goal stats — weekly pace & projected completion", () => {
  test("a brand-new goal with no transactions at all is not_reachable (zero velocity)", async () => {
    const alice = await newUser("goals-stats-not-reachable@example.com");
    const created = await alice
      .post("/api/goals")
      .send({ name: "No income yet", target_cents: 100000, deadline: future(70) });

    expect(created.body.status).toBe("not_reachable");
    expect(created.body.velocity_weekly_cents).toBe(0);
    expect(created.body.saved_cents).toBe(0);
    expect(created.body.projected_completion).toBeNull();
  });

  test("a goal already met (savings >= target) is done, with zero remaining and today as the projection", async () => {
    const alice = await newUser("goals-stats-done@example.com");
    // Clamped saved_cents means an income bigger than the target still just
    // reads as 100% saved, not more.
    await alice
      .post("/api/transactions")
      .send({ date: todayISO(), description: "Bonus", amount_cents: 6000, category: "Income" });

    const created = await alice
      .post("/api/goals")
      .send({ name: "Small goal", target_cents: 5000, deadline: future(70) });

    expect(created.body.status).toBe("done");
    expect(created.body.saved_cents).toBe(5000);
    expect(created.body.remaining_cents).toBe(0);
    expect(created.body.required_weekly_cents).toBe(0);
    expect(created.body.projected_completion).toBe(todayISO());
  });

  test("a deadline of today with money still owed has no achievable weekly pace (null, not a crash)", async () => {
    const alice = await newUser("goals-stats-zero-weeks@example.com");
    // Gives the account a real, positive velocity so this isn't just the
    // zero-velocity not_reachable case in disguise.
    await alice
      .post("/api/transactions")
      .send({ date: todayISO(), description: "Paycheck", amount_cents: 2000, category: "Income" });

    const created = await alice
      .post("/api/goals")
      .send({ name: "Due today", target_cents: 100000, deadline: todayISO() });

    expect(created.body.remaining_cents).toBeGreaterThan(0);
    expect(created.body.weeks_left).toBe(0);
    expect(created.body.required_weekly_cents).toBeNull();
    expect(created.body.status).toBe("behind");
  });

  test("marks a goal on_track when velocity meets the required weekly pace", async () => {
    const alice = await newUser("goals-stats-on-track@example.com");
    await alice
      .post("/api/transactions")
      .send({ date: todayISO(), description: "Paycheck", amount_cents: 50000, category: "Income" });

    const created = await alice
      .post("/api/goals")
      .send({ name: "On pace", target_cents: 100000, deadline: future(70) }); // exactly 10 weeks out

    expect(created.body.remaining_cents).toBe(50000);
    expect(created.body.weeks_left).toBe(10);
    expect(created.body.required_weekly_cents).toBe(5000); // 50,000 / 10 weeks
    expect(created.body.velocity_weekly_cents).toBe(6250); // 50,000 / 8-week window
    expect(created.body.status).toBe("on_track");
  });

  test("marks a goal behind when velocity falls short of the required weekly pace", async () => {
    const alice = await newUser("goals-stats-behind@example.com");
    await alice
      .post("/api/transactions")
      .send({ date: todayISO(), description: "Paycheck", amount_cents: 7000, category: "Income" });

    const created = await alice
      .post("/api/goals")
      .send({ name: "Behind pace", target_cents: 100000, deadline: future(70) }); // 10 weeks out

    expect(created.body.remaining_cents).toBe(93000);
    expect(created.body.required_weekly_cents).toBe(9300); // 93,000 / 10 weeks
    expect(created.body.velocity_weekly_cents).toBe(875); // 7,000 / 8-week window
    expect(created.body.status).toBe("behind");
  });

  test("Transfers are excluded from both velocity and saved-toward-goal totals", async () => {
    const alice = await newUser("goals-stats-transfers@example.com");
    await alice
      .post("/api/transactions")
      .send({ date: todayISO(), description: "Move to savings", amount_cents: 20000, category: "Transfers" });

    const created = await alice
      .post("/api/goals")
      .send({ name: "Ignores transfers", target_cents: 10000, deadline: future(30) });

    expect(created.body.saved_cents).toBe(0);
    expect(created.body.velocity_weekly_cents).toBe(0);
    expect(created.body.status).toBe("not_reachable");
  });
});
