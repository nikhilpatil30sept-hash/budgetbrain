import { defineConfig, devices } from '@playwright/test';

/**
 * Deployment tests: run against an already-running BudgetBrain, never a dev
 * server. Two targets use this config:
 *   - CI's docker-smoke job: the production image on http://localhost:3001
 *   - the AWS deploy workflow: the live HTTPS URL on ECS Express Mode
 * Checks that only mean something behind the real load balancer and TLS
 * (certificate, Secure cookies, X-Forwarded-For handling) skip themselves
 * on plain http.
 */
const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error('Set BASE_URL to the running app, e.g. http://localhost:3001 or the AWS service URL.');
}

export default defineConfig({
  testDir: './cloud',
  globalSetup: './cloud/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // No retries against a real environment: a retry can hide a deploy that
  // only works some of the time, and every attempt spends the production
  // auth rate-limit budget (see global-setup.ts).
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-cloud', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'cloud', use: { ...devices['Desktop Chrome'] } }],
});
