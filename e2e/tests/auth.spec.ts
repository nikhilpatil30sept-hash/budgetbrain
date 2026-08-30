import { test, expect } from '@playwright/test';
import { login, todayISO, DEMO_PASSWORD } from './utils';

/**
 * Authentication suite. Unlike the other specs, BB-A1 deliberately creates
 * its own brand-new account rather than using the shared seeded one — the
 * whole point is to prove a fresh signup starts empty and a fresh account's
 * data survives a logout/login round trip, which the seeded account (full
 * of pre-existing transactions) can't demonstrate on its own.
 */

test('BB-A1: sign up, land on an empty dashboard, and log back in with data intact', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct-horse-1';

  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // A brand-new account never inherits anyone else's data.
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByText('No transactions here!')).toBeVisible();

  const description = `E2E signup coffee ${Date.now()}`;
  await page.getByLabel('Date', { exact: true }).fill(todayISO());
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Amount', { exact: true }).fill('3.25');
  await page.getByRole('button', { name: 'Add it!' }).click();
  await expect(page.getByRole('row', { name: new RegExp(description) })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('row', { name: new RegExp(description) })).toBeVisible();
});

test('BB-A2: signing up with an email that already has an account is rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill('demo@budgetbrain.local');
  await page.getByLabel(/^Password/).fill('some-other-password-1');
  await page.getByLabel('Confirm password').fill('some-other-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('An account with that email already exists')).toBeVisible();
});

test('BB-A3: a wrong password is rejected without revealing whether the email exists', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('demo@budgetbrain.local');
  await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Invalid email or password')).toBeVisible();
});

test('BB-A4: an unauthenticated visitor sees the login screen, not the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add it!' })).not.toBeVisible();
});

test('BB-A5: a logged-in session survives a page refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('demo@budgetbrain.local');
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});
