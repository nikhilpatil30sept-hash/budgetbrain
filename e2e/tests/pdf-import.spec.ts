import { test, expect } from '@playwright/test';
import path from 'path';
import { login } from './utils';

/**
 * Coverage for PDF bank-statement import (see README.md's PDF-import design
 * notes and TEST-CASES.md's BB-P1..BB-P5).
 *
 * Deliberately does NOT click "Extract transactions with AI": CI has no
 * GEMINI_API_KEY configured (see .github/workflows/ci.yml) and this project
 * has no precedent for e2e tests that hit a real AI provider. These tests
 * instead cover everything that happens client-side, before any network
 * call would be made — PDF text extraction, header cropping, and PII
 * redaction (BB-P2/BB-P3/BB-P4), plus the scanned-PDF rejection path
 * (BB-P5). BB-P1 (the full extract -> import -> auto-label happy path with
 * a live Gemini call) stays a manual-only check, same as AI categorization
 * elsewhere in this suite.
 *
 * Fixtures (e2e/fixtures/*.pdf) are entirely synthetic/fictional — no real
 * statement data — generated for this spec.
 */

const DIGITAL_STATEMENT = path.join(__dirname, '../fixtures/digital-statement.pdf');
const SCANNED_STATEMENT = path.join(__dirname, '../fixtures/scanned-statement.pdf');

test.describe('PDF statement import', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: /PDF statement/ }).click();
  });

  test("BB-P2/P3/P4: crops the identity block and redacts identifiers that survive into the transaction table", async ({
    page,
  }) => {
    // The fixture repeats an "MR JANE DOE - 1234 XXXX XXXX 5678" identity
    // line right after the transaction-table header (the exact shape of the
    // bug fixed in 4d73e9d — a per-page repeated header line surviving a
    // crop-once design), and has an asterisk-masked "*****12*3456" account
    // reference inside a transaction line (the bug fixed in 9c261ab — a
    // digit-run redaction regex that never matched "*"). Both must be gone
    // from what the app shows/would send, while legitimate transaction text
    // from both pages of the statement survives.
    const fileInput = page.locator('input[type="file"][accept=".pdf,application/pdf"]');
    await fileInput.setInputFiles(DIGITAL_STATEMENT);

    await expect(page.getByRole('heading', { name: /What we'll send to the AI/ })).toBeVisible();

    const previewText = await page.locator('textarea[readonly]').inputValue();

    // The identity/header block must not have survived at all.
    expect(previewText).not.toContain('JANE DOE');
    expect(previewText).not.toMatch(/[Xx]{2,}/);
    expect(previewText).not.toContain('1234');
    expect(previewText).not.toContain('5678');

    // The asterisk-masked reference must be redacted.
    expect(previewText).not.toContain('*****12*3456');
    expect(previewText).toContain('[REDACTED]');

    // Legitimate transaction content from both fixture pages must survive.
    expect(previewText).toContain('ZORKMART GROCERY');
    expect(previewText).toContain('COFFEE SHOP');
    expect(previewText).toContain('GAS STATION');
    expect(previewText).toContain('BOOKSTORE');

    // The header boundary was found and cropped cleanly, so the
    // couldn't-find-the-boundary warning banner must not appear.
    await expect(
      page.getByText(/couldn't automatically find where your transaction list starts/)
    ).not.toBeVisible();

    // The extract button is reachable but deliberately not clicked here —
    // no live AI call in this spec (see file header comment).
    await expect(page.getByRole('button', { name: /Extract transactions with AI/ })).toBeVisible();
  });

  test('BB-P5: rejects a scanned/image PDF before any network call', async ({ page }) => {
    const extractCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/extract-pdf')) extractCalls.push(req.url());
    });

    const fileInput = page.locator('input[type="file"][accept=".pdf,application/pdf"]');
    await fileInput.setInputFiles(SCANNED_STATEMENT);

    await expect(
      page.getByRole('status').filter({ hasText: 'scanned or image PDF' })
    ).toBeVisible();

    // Never reaches the "what we'll send" preview, and never calls the AI.
    await expect(page.getByRole('heading', { name: /What we'll send to the AI/ })).not.toBeVisible();
    expect(extractCalls).toHaveLength(0);
  });
});
