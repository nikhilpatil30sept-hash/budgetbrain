import { afterEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../app";

const app = createApp();
const originalTurso = process.env.TURSO_DATABASE_URL;

afterEach(() => {
  if (originalTurso === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalTurso;
});

describe("GET /api/health", () => {
  test("reports which database the process is using (vitest.setup.ts points it at a temp SQLite file)", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.database).toBe("local-file");
    expect(typeof res.body.gemini_key_configured).toBe("boolean");
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });

  test("reports turso once TURSO_DATABASE_URL is set, matching the URL resolveDbUrl() picks first", async () => {
    // Only the reported value is checked here; no connection is made.
    process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";

    const res = await request(app).get("/api/health");

    expect(res.body.database).toBe("turso");
  });

  test("never leaks the database URL or any secret, only the kind", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://secret-name.turso.io";

    const res = await request(app).get("/api/health");

    expect(JSON.stringify(res.body)).not.toContain("secret-name");
  });
});
