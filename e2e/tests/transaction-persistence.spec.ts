import { test, expect } from '@playwright/test';
import { login, todayISO } from './utils';

test('BB-8: a saved transaction persists after a page refresh', async ({ page }) => {
  const description = `BB-8 persistence check ${Date.now()}`;

  await login(page);
  await page.getByLabel('Date', { exact: true }).fill(todayISO());
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Amount', { exact: true }).fill('6.25');
  await page.getByRole('button', { name: 'Add it!' }).click();

  const row = page.getByRole('row', { name: new RegExp(description) });
  await expect(row).toBeVisible();

  // The real assertion: a reload drops all client-side state (including the
  // optimistic UI row from handleAdd), so the row can only reappear if it
  // was actually written to the database.
  await page.reload();

  await expect(page.getByRole('row', { name: new RegExp(description) })).toBeVisible();
});
