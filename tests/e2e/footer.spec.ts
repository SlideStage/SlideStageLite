/**
 * Landing-footer beian chip e2e.
 *
 * Verifies the contract from the user's perspective:
 *   1. Landing page renders the footer with the local-runtime status line.
 *   2. With no VITE_BEIAN_* env in the dev bundle, no ICP / MPS chip leaks.
 *   3. As soon as a deck is opened, the footer disappears so the
 *      presenter view is not occluded by beian links.
 *
 * If a developer copies `.env.example` to `.env` and fills in the beian
 * variables, restarting the dev server will surface the chips — those
 * combinations are covered by the unit tests in src/app/Footer.test.tsx
 * (no need to re-run dev with custom env from Playwright).
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('renders the landing footer with the local-runtime status', async ({ page }) => {
  await page.goto('/');

  const footer = page.getByTestId('app-footer');
  await expect(footer).toBeVisible();

  const status = page.getByTestId('app-footer-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/Runs locally|本地运行/);
});

test('does not leak beian chips when VITE_BEIAN_* env is unset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-footer-icp')).toHaveCount(0);
  await expect(page.getByTestId('app-footer-mps')).toHaveCount(0);
});

test('always exposes a slidestage.dev link from the landing footer', async ({
  page,
}) => {
  await page.goto('/');
  const link = page.getByTestId('app-footer-site');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://slidestage.dev/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toContainText('slidestage.dev');
});

test('hides the footer once a deck is opened (presenter stage stays clean)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('app-footer')).toBeVisible();

  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByTestId('deck-stage')).toBeVisible();
  await expect(page.getByTestId('app-footer')).toHaveCount(0);
});
