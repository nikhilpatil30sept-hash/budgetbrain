import { expect, type Page } from '@playwright/test';

/** Today's date as YYYY-MM-DD, matching what the app's own date inputs use. */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** A date `yearsFromNow` years out, same YYYY-MM-DD format. */
export function futureDateISO(yearsFromNow: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearsFromNow);
  return d.toISOString().slice(0, 10);
}

/** Parses a rendered "$1,234.56"-style string back into integer cents. */
export function dollarsTextToCents(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  return Math.round(parseFloat(cleaned) * 100);
}

/** Reads the ledger's "N transactions" footer count (assumes at least one row exists). */
export async function readTransactionCount(page: Page): Promise<number> {
  const countText = page.getByText(/^\d+ transactions?$/);
  await expect(countText).toBeVisible();
  return parseInt(await countText.innerText(), 10);
}

// The seeded dev account (`npm run seed`, from the repo root) — every spec
// in this suite runs against one shared dev server + database, so logging
// in as this one account is how each test gets past the login screen.
export const DEMO_EMAIL = 'demo@budgetbrain.local';
export const DEMO_PASSWORD = 'password123';

/** Logs into the seeded dev account and waits for the dashboard to be up. */
export async function login(page: Page, email = DEMO_EMAIL, password = DEMO_PASSWORD): Promise<void> {
  await page.goto('/');

  // The app briefly shows a loading skeleton while it checks for an
  // existing session (GET /api/auth/me) before deciding whether to render
  // the login form or the dashboard. Checking "is the Log in button
  // visible?" right away can catch that in-between moment — neither button
  // exists yet — and wrongly read as "already logged in". Wait for the
  // outcome to actually resolve one way or the other first.
  await page.waitForFunction(() => {
    const label = (b: Element) => b.textContent?.trim();
    return Array.from(document.querySelectorAll('button')).some(
      (b) => label(b) === 'Log in' || label(b) === 'Log out'
    );
  });

  const stillLoggedOut = await page.getByRole('button', { name: 'Log in' }).isVisible();
  if (!stillLoggedOut) return; // already logged in

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  // Firefox intermittently takes longer than the 5s default here once the
  // dev server has already been running other browsers' tests for a while
  // (observed failing on different tests each time under a combined
  // chromium+firefox run, never on a fresh Firefox-only run) — this is
  // render/network timing variance, not a broken login, so give it more room
  // rather than risk a false failure.
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 10_000 });
}
