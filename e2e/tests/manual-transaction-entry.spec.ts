import { test, expect } from '@playwright/test';
import { login, todayISO, dollarsTextToCents } from './utils';

test('BB-1: add a valid transaction successfully', async ({ page }) => {
  const description = `Coffee ${Date.now()}`;

  await login(page);

  // Baseline "Spent this month" total, read before the new transaction exists.
  const spentValue = page.locator('p:has-text("Spent this month") + p');
  await expect(spentValue).toBeVisible();
  await page.waitForTimeout(1000); // let the tile's 0.8s count-up animation settle
  const spentBeforeCents = dollarsTextToCents(await spentValue.innerText());

  await page.getByLabel('Date', { exact: true }).fill(todayISO());
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Amount', { exact: true }).fill('4.50');
  await page.getByRole('button', { name: 'Add it!' }).click();

  const row = page.getByRole('row', { name: new RegExp(description) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(todayISO());
  await expect(row).toContainText('-$4.50');

  // The "And" step of BB-1: the monthly total must move by exactly the
  // amount just added, not just "some new row appeared".
  await page.waitForTimeout(1000); // let the animation settle on the new value
  const spentAfterCents = dollarsTextToCents(await spentValue.innerText());
  expect(spentAfterCents - spentBeforeCents).toBe(450);
});
