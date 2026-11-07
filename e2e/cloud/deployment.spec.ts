import tls from 'node:tls';
import { test, expect, type APIResponse } from '@playwright/test';

/**
 * Deployment checks (BB-C1 to BB-C9). These run against a deployed or
 * containerized BudgetBrain, not the dev server, and check what a deploy can
 * break even when every unit, integration and e2e test passed: secrets
 * wiring, TLS, headers, static hosting, cookies and proxy handling.
 * See playwright.cloud.config.ts for the two targets.
 */

const baseURL = process.env.BASE_URL!;
const target = new URL(baseURL);
const isHttps = target.protocol === 'https:';
const HTTPS_ONLY = 'Only meaningful behind the real load balancer and TLS (the AWS deployment).';

const PASSWORD = 'cloud-check-password-1';
const uniqueEmail = (label: string) => `cloud-${label}-${Date.now()}@example.com`;

/** The raw Set-Cookie header for the session cookie, e.g. "sid=...; Path=/; HttpOnly". */
function sessionSetCookie(res: APIResponse): string | undefined {
  return res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value)
    .find((v) => v.startsWith('sid='));
}

interface TlsInfo {
  protocol: string | null;
  validTo: Date;
}

/** Full TLS handshake with certificate-chain AND hostname verification. */
function tlsHandshake(host: string, port = 443): Promise<TlsInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ protocol: socket.getProtocol(), validTo: new Date(cert.valid_to) });
      socket.end();
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error(`TLS handshake with ${host} timed out`)));
    socket.on('error', reject);
  });
}

test('BB-C1: health check answers from the live process and reports the expected database', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body.ok).toBe(true);
  // Generated per request, so a cached or stale response can't pass.
  expect(Math.abs(Date.now() - Date.parse(body.time))).toBeLessThan(5 * 60_000);

  // A missing TURSO_DATABASE_URL secret doesn't crash the app: it silently
  // falls back to a SQLite file inside the container, which is wiped on the
  // next deploy. The deploy workflow sets EXPECT_DATABASE=turso to catch that.
  if (process.env.EXPECT_DATABASE) {
    expect(body.database).toBe(process.env.EXPECT_DATABASE);
  }
  if (process.env.EXPECT_GEMINI_KEY) {
    expect(body.gemini_key_configured).toBe(process.env.EXPECT_GEMINI_KEY === 'true');
  }
});

test('BB-C2: the TLS certificate is valid for this hostname, not close to expiry, on TLS 1.2+', async () => {
  test.skip(!isHttps, HTTPS_ONLY);

  const info = await tlsHandshake(target.hostname, Number(target.port) || 443);

  expect(['TLSv1.2', 'TLSv1.3']).toContain(info.protocol);
  const daysLeft = (info.validTo.getTime() - Date.now()) / 86_400_000;
  expect(daysLeft).toBeGreaterThan(14);
});

test('BB-C3: plain HTTP never serves the app (redirects to HTTPS, refuses, or is closed)', async () => {
  test.skip(!isHttps, HTTPS_ONLY);

  let res: Response;
  try {
    res = await fetch(`http://${target.host}/`, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
  } catch {
    test.info().annotations.push({ type: 'note', description: 'Nothing answers on port 80, so there is no plain-HTTP path.' });
    return;
  }

  if (res.status >= 300 && res.status < 400) {
    expect(res.headers.get('location') ?? '').toMatch(/^https:\/\//);
  } else {
    // A shared load balancer listener may answer with its own error page;
    // that's fine as long as it isn't BudgetBrain itself over plain HTTP.
    const body = await res.text();
    expect(body, `port 80 answered ${res.status} with the app itself`).not.toContain('<div id="root">');
  }
});

test('BB-C4: security headers survive the load balancer on pages and API responses', async ({ request }) => {
  for (const path of ['/', '/api/health']) {
    const headers = (await request.get(path)).headers();

    expect(headers['content-security-policy'], path).toContain("default-src 'self'");
    expect(headers['content-security-policy'], path).toContain("script-src 'self'");
    expect(headers['strict-transport-security'], path).toMatch(/max-age=\d{7,}/);
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['x-frame-options'], path).toBe('SAMEORIGIN');
    expect(headers['x-powered-by'], path).toBeUndefined();
  }
});

test('BB-C5: the built React app and its assets are served, and deep links fall back to index.html', async ({ request }) => {
  const home = await request.get('/');
  expect(home.status()).toBe(200);
  expect(home.headers()['content-type']).toContain('text/html');
  const html = await home.text();
  expect(html).toContain('<div id="root">');

  const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(script, 'index.html should reference the built JS bundle').toBeTruthy();
  const js = await request.get(script!);
  expect(js.status()).toBe(200);
  expect(js.headers()['content-type']).toMatch(/javascript/);

  const deepLink = await request.get('/some/deep/link');
  expect(deepLink.status()).toBe(200);
  expect(deepLink.headers()['content-type']).toContain('text/html');
});

test('BB-C6: API errors stay JSON and never fall through to the HTML app', async ({ request }) => {
  for (const path of ['/api/transactions', '/api/this-route-does-not-exist']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(401);
    expect(res.headers()['content-type'], path).toContain('application/json');
  }
});

test('BB-C7: the session cookie is HttpOnly, SameSite=Lax and Secure over HTTPS, and logout kills it server-side', async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL });
  const email = uniqueEmail('api');

  const signup = await api.post('/api/auth/signup', { data: { email, password: PASSWORD } });
  expect(signup.status()).toBe(201);

  const setCookie = sessionSetCookie(signup);
  expect(setCookie, 'signup should set the sid session cookie').toBeTruthy();
  expect(setCookie).toMatch(/;\s*HttpOnly/i);
  expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
  expect(setCookie).toMatch(/;\s*Path=\//i);
  if (isHttps) expect(setCookie).toMatch(/;\s*Secure/i);

  // Send the cookie by hand so the check doesn't depend on how the client
  // jar treats Secure cookies over http://localhost.
  const cookie = { cookie: setCookie!.split(';')[0] };
  const me = await api.get('/api/auth/me', { headers: cookie });
  expect(me.status()).toBe(200);
  expect((await me.json()).email).toBe(email);

  expect((await api.post('/api/auth/logout', { headers: cookie })).status()).toBe(204);
  // The same token replayed after logout must be dead on the server, not
  // just cleared in the browser.
  expect((await api.get('/api/auth/me', { headers: cookie })).status()).toBe(401);

  await api.dispose();
});

test('BB-C8: a new user can sign up, log out and log back in, with no script errors or CSP violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The app checks for an existing session on load (GET /api/auth/me);
    // a 401 there is expected for a logged-out visitor and Chrome logs it.
    if (/status of 401/.test(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });

  const email = uniqueEmail('ui');
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No transactions here!')).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 15_000 });

  expect(problems).toEqual([]);
});

test('BB-C9: a spoofed X-Forwarded-For header cannot reset the login rate limit', async ({ playwright }) => {
  test.skip(!isHttps, HTTPS_ONLY);

  // The server trusts exactly one proxy hop (app.ts: trust proxy = 1). Behind
  // the load balancer that hop is the balancer itself, which appends the real
  // client address, so a made-up address sent by the client must be ignored.
  // If the hop count were wrong, every made-up address would get its own
  // fresh budget and brute-force protection would be gone.
  // Assumes one running task: the limiter's counts live in process memory.
  const api = await playwright.request.newContext({ baseURL });
  const remaining: number[] = [];
  for (let i = 0; i < 3; i++) {
    const res = await api.post('/api/auth/login', {
      data: { email: 'nobody@example.com', password: 'not-the-password' },
      headers: { 'X-Forwarded-For': `203.0.113.${10 + i}` },
    });
    expect(res.status()).toBe(401);
    remaining.push(Number(res.headers()['ratelimit-remaining']));
  }

  expect(remaining[1]).toBe(remaining[0] - 1);
  expect(remaining[2]).toBe(remaining[1] - 1);

  await api.dispose();
});
