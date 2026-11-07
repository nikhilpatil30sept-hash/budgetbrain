import { request, type FullConfig } from '@playwright/test';

// In production every /api/auth route shares one limiter: 20 requests per
// 15 minutes per client IP (server/src/routes/auth.ts). This suite makes
// about a dozen auth calls. If a deploy runs again before an earlier run's
// window has reset, the tests would fail with 429s that have nothing to do
// with the new version (and the deploy workflow would roll it back), so
// wait the window out here instead.
const AUTH_CALLS_NEEDED = 12;
const MAX_WAIT_SECONDS = 16 * 60;
const HEALTH_TIMEOUT_MS = 3 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL;
  const api = await request.newContext({ baseURL });

  try {
    // A fresh task can take a little while to pass the load balancer's
    // health check after the deploy step returns, so poll before testing.
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    for (;;) {
      const res = await api.get('/api/health').catch(() => null);
      if (res?.ok()) break;
      if (Date.now() > deadline) {
        throw new Error(`${baseURL}/api/health did not return 200 within ${HEALTH_TIMEOUT_MS / 1000}s`);
      }
      await sleep(5_000);
    }

    const probe = await api.get('/api/auth/me');
    const remaining = Number(probe.headers()['ratelimit-remaining']);
    const resetSeconds = Number(probe.headers()['ratelimit-reset']);
    if (Number.isFinite(remaining) && Number.isFinite(resetSeconds) && remaining < AUTH_CALLS_NEEDED) {
      const wait = Math.min(resetSeconds + 5, MAX_WAIT_SECONDS);
      console.log(
        `Auth rate limit has only ${remaining} requests left from an earlier run; waiting ${wait}s for the window to reset.`
      );
      await sleep(wait * 1000);
    }
  } finally {
    await api.dispose();
  }
}
