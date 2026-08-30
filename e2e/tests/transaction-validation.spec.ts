import { test, expect } from '@playwright/test';
import { login, todayISO, futureDateISO, readTransactionCount } from './utils';

/**
 * BB-2, BB-4, BB-5, BB-6 all follow the same shape: attempt an invalid
 * "Add Transaction" submission, confirm what actually blocks it, and confirm
 * the ledger's total count did not change — the post-condition every one of
 * these cases states ("no new transaction added to the database").
 */
test.describe('Transaction form validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('BB-2: rejects a zero-amount transaction', async ({ page }) => {
    const before = await readTransactionCount(page);

    await page.getByLabel('Date', { exact: true }).fill(todayISO());
    await page.getByLabel('Description', { exact: true }).fill(`BB-2 zero amount ${Date.now()}`);
    await page.getByLabel('Amount', { exact: true }).fill('0.00');
    await page.getByRole('button', { name: 'Add it!' }).click();

    await expect(page.getByText('A positive amount, up to 2 decimals')).toBeVisible();
    expect(await readTransactionCount(page)).toBe(before);
  });

  test('BB-4: rejects a typed negative amount (sign comes from the Expense/Income toggle instead)', async ({
    page,
  }) => {
    const before = await readTransactionCount(page);

    await page.getByLabel('Date', { exact: true }).fill(todayISO());
    await page.getByLabel('Description', { exact: true }).fill(`BB-4 negative amount ${Date.now()}`);
    await page.getByLabel('Amount', { exact: true }).fill('-10.00');
    await page.getByRole('button', { name: 'Add it!' }).click();

    // parsePositiveAmountToCents only accepts positive numeric strings, so a
    // leading "-" fails to parse the same way "0.00" does — same error text.
    await expect(page.getByText('A positive amount, up to 2 decimals')).toBeVisible();
    expect(await readTransactionCount(page)).toBe(before);
  });

  test('BB-5: blocks a transaction dated a year in the future', async ({ page }) => {
    const before = await readTransactionCount(page);

    const dateInput = page.getByLabel('Date', { exact: true });
    await dateInput.fill(futureDateISO(1));
    await page.getByLabel('Description', { exact: true }).fill(`BB-5 future date ${Date.now()}`);
    await page.getByLabel('Amount', { exact: true }).fill('25.00');

    // The date input carries a native `max={today}` attribute. Clicking a
    // submit button runs the browser's own constraint validation before
    // React's onSubmit ever fires, so there's no custom error message to
    // look for — the app's own "No fortune-telling" JS check never gets a
    // chance to run for a real date-picker selection. Assert the actual
    // mechanism: no request goes out, and the input itself reports invalid.
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/transactions')) posts.push(req.url());
    });

    await page.getByRole('button', { name: 'Add it!' }).click();
    await page.waitForTimeout(500);

    expect(posts).toHaveLength(0);
    const rangeOverflow = await dateInput.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow);
    expect(rangeOverflow).toBe(true);
    expect(await readTransactionCount(page)).toBe(before);
  });

  test('BB-6: rejects an empty description', async ({ page }) => {
    const before = await readTransactionCount(page);

    await page.getByLabel('Date', { exact: true }).fill(todayISO());
    await page.getByLabel('Description', { exact: true }).fill('');
    await page.getByLabel('Amount', { exact: true }).fill('12.00');
    await page.getByRole('button', { name: 'Add it!' }).click();

    await expect(page.getByText('Give it a name')).toBeVisible();
    expect(await readTransactionCount(page)).toBe(before);
  });
});
