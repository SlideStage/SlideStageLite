import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('opens a deck whose manifest.totalSlides and slides[].index disagree', async ({ page }) => {
  await page.goto('/');

  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/mismatched-counts.stage'));

  await expect(page.getByRole('heading', { name: 'Mismatched Counts Deck' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 3');

  await page.keyboard.press('End');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('3 / 3');

  await page.keyboard.press('Home');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 3');
});

test('opens a deck whose manifest.id contains spaces and punctuation', async ({ page }) => {
  await page.goto('/');

  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/relaxed-id.stage'));

  await expect(page.getByRole('heading', { name: 'Relaxed Id Deck' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 1');
});
