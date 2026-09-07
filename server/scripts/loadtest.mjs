#!/usr/bin/env node
// A small local load/concurrency smoke test -- NOT part of CI. It needs a
// real running instance (npm run dev, or a production-mode build) and the
// seeded demo account, neither of which a Vitest integration test has.
//
// Usage (see TEST-PLAN.md for the full writeup):
//   1. In one terminal: npm run dev            (from the repo root)
//   2. In another:      npm run seed           (from the repo root, once)
//   3. Then:             npm run loadtest -w server
//
// Env vars (all optional):
//   BASE_URL     default http://localhost:3001 -- hits the Express server
//                directly, bypassing Vite's dev proxy.
//   CONNECTIONS  default 10  -- concurrent connections per phase.
//   DURATION     default 10  -- seconds per phase.
import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 10);
const DURATION = Number(process.env.DURATION ?? 10);
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@budgetbrain.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "password123";

function summarize(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(`  ${result.requests.average.toFixed(0)} req/sec avg (${result.requests.total} total)`);
  console.log(
    `  latency: ${result.latency.average.toFixed(1)}ms avg, ${result.latency.p99.toFixed(1)}ms p99`
  );
  console.log(`  errors: ${result.errors}, timeouts: ${result.timeouts}, non-2xx: ${result.non2xx}`);
}

async function run(label, opts) {
  const result = await autocannon({
    url: BASE_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    ...opts,
  });
  summarize(label, result);
  return result;
}

async function main() {
  console.log(`Load-testing ${BASE_URL} (${CONNECTIONS} connections x ${DURATION}s per phase)`);

  // Phase 1: the public, unauthenticated health check -- a baseline with
  // no DB read/write at all, and (per app.ts) it sits BEHIND the global
  // rate limiter, so this phase alone can trip a 429 storm if the limiter
  // is ever set too low again -- see non2xx/errors above if so.
  await run("GET /api/health (public, no DB)", { path: "/api/health" });

  // Phase 2: log in once as the seeded demo account and reuse that session
  // cookie for every authenticated request below -- exactly how a real
  // browser session behaves, not a fresh login per request.
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error(
      `\nCouldn't log in as ${DEMO_EMAIL} (${loginRes.status}). Run \`npm run seed\` from the repo root first.`
    );
    process.exit(1);
  }
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];

  await run("GET /api/transactions (authenticated, DB read)", {
    path: "/api/transactions",
    headers: { cookie },
  });

  await run("GET /api/summary (authenticated, DB aggregation)", {
    path: "/api/summary",
    headers: { cookie },
  });

  console.log(
    "\nDone. A healthy result: 0 timeouts, 0 non-2xx, and p99 latency in the tens of milliseconds " +
      "(this is a single small free-tier-shaped instance, not a production cluster -- the point is " +
      "catching a regression that makes these numbers suddenly much worse, not chasing a specific target)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
