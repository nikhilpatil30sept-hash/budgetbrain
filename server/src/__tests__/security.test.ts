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

describe("security headers (helmet)", () => {
  test("a plain, unauthenticated request still gets helmet's security headers", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["referrer-policy"]).toBeTruthy();
  });

  test("the CSP override for inline styles is actually wired in, not just helmet's stock default", async () => {
    const res = await request(app).get("/api/health");
    const csp = res.headers["content-security-policy"];

    expect(csp).toBeTruthy();
    // helmet's own default style-src is just 'self' -- proving
    // 'unsafe-inline' is present confirms app.ts's override took effect,
    // not merely that helmet ran at all.
    expect(csp).toMatch(/style-src[^;]*'self'[^;]*'unsafe-inline'/);
  });

  test("a 404 (never reaching a route handler) still carries the headers too", async () => {
    // Unauthenticated requests to an unmatched /api/* path never actually
    // reach the 404 handler -- app.ts mounts requireAuth broadly at "/api"
    // (ahead of aiRouter), so they 401 out first. To exercise the real
    // "no route matched" path, authenticate first and then hit a path no
    // router owns.
    const alice = await newUser("security-404@example.com");
    const res = await alice.get("/api/this-route-does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("an unauthenticated request to an unmatched /api/* path is still safely handled (401, not a crash), and still carries the headers", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist");

    expect(res.status).toBe(401);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
