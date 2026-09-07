import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './utils';

/**
 * Accessibility smoke test (requirements: regression-security #4). This is
 * a floor, not a full audit -- it fails the build on any *serious* or
 * *critical* automated violation (missing labels, bad contrast, invalid
 * ARIA, keyboard traps, etc.) on the three screens most people actually
 * use, without trying to be a complete WCAG audit.
 */

function seriousOrWorse(violations: { impact?: string | null }[]) {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test('login page has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  // Let the logo's entrance animation settle -- axe samples the live DOM,
  // and mid-animation opacity/color values produce false-positive contrast
  // violations. Same pattern as manual-transaction-entry.spec.ts's BB-1
  // (0.8s count-up settle wait).
  await page.waitForTimeout(1000);

  const results = await new AxeBuilder({ page }).analyze();
  expect(seriousOrWorse(results.violations), JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('dashboard has no serious or critical accessibility violations', async ({ page }) => {
  await login(page);
  // Let the "Welcome back!" toast and header entrance animations settle
  // before sampling -- see the note above.
  await page.waitForTimeout(1000);

  const results = await new AxeBuilder({ page }).analyze();
  expect(seriousOrWorse(results.violations), JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('the transaction entry form has no serious or critical accessibility violations', async ({ page }) => {
  await login(page);
  await expect(page.getByLabel('Date', { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);

  // Scoped to the form itself rather than the whole dashboard -- this is
  // specifically about the form's own labels/roles/focus order, independent
  // of the rest of the dashboard's chrome (which the previous test already
  // covers).
  const results = await new AxeBuilder({ page }).include('form').analyze();
  expect(seriousOrWorse(results.violations), JSON.stringify(results.violations, null, 2)).toEqual([]);
});
