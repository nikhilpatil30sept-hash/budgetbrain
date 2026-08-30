import { test, expect } from '@playwright/test';
import { login, todayISO } from './utils';

test('BB-7: an unusually long description wraps at word boundaries instead of clipping mid-word', async ({
  page,
}) => {
  const marker = `BB-7-${Date.now()}`;
  const description =
    `A very long transaction description used to regression-test text wrapping ${marker} — ` +
    'this text is intentionally well over one hundred characters so it exercises the same ' +
    'layout path that used to clip mid-word under a single-line CSS ellipsis before the fix.';

  await login(page);
  await page.getByLabel('Date', { exact: true }).fill(todayISO());
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Amount', { exact: true }).fill('9.99');
  await page.getByRole('button', { name: 'Add it!' }).click();

  const row = page.getByRole('row', { name: new RegExp(marker) });
  await expect(row).toBeVisible();

  // Regression guard tied to the actual fix (TransactionList.tsx:75-76): the
  // description must render inside the multi-line clamp span, not the old
  // single-line ellipsis. If a future change reverts to `truncate`, this fails.
  await expect(row.locator('span.line-clamp-2')).toBeVisible();
  await expect(row.locator('span.truncate')).toHaveCount(0);

  // The full text must survive intact even though it's visually clamped —
  // the cell's title attribute carries the untruncated string for the hover tooltip.
  await expect(row.getByTitle(description)).toBeVisible();
});
