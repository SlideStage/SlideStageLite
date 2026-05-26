import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('converts an inline-deck source via the SPA Convert panel and loads it', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();
  await expect(page.getByRole('heading', { name: 'Convert from HTML deck' })).toBeVisible();

  await page
    .getByTestId('converter-file-input')
    .setInputFiles(resolve('tests/fixtures/sources/html-ppt-inline-deck.zip'));

  await expect(page.getByTestId('converter-selection')).toContainText(
    'html-ppt-inline-deck.zip',
  );

  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();

  // The converter panel closes after handoff; deck viewer shows the converted deck.
  await expect(page.getByRole('heading', { name: 'html-ppt-skill flavored deck' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 3');

  // Navigate forward — proves the converter built a proper multi-file deck.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('2 / 3');

  const slide2 = page.frameLocator('iframe[title="Slide 2: Two"]');
  await expect(slide2.locator('section.slide h1')).toHaveText('Inline 2');
});

test('Convert & Download offers a .stage blob without leaving the page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();

  await page
    .getByTestId('converter-file-input')
    .setInputFiles(resolve('tests/fixtures/sources/huashu-webcomponent-deck.zip'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Convert & Download' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('huashu-webcomponent-deck.stage');

  // The result summary should reflect the split mode default for WC sources.
  await expect(page.locator('.converter-panel__result')).toContainText('Converted 2 slides');
  await expect(page.locator('.converter-panel__result')).toContainText('split');
});

test('offline mirror toggle exposes progress + summary when enabled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();

  await page
    .getByTestId('converter-file-input')
    .setInputFiles(resolve('tests/fixtures/sources/html-ppt-inline-deck.zip'));

  // Flip the offline mirror toggle on before converting.
  await page.getByTestId('converter-mirror-toggle').check();
  await expect(page.getByTestId('converter-mirror-toggle')).toBeChecked();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Convert & Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('html-ppt-inline-deck.stage');

  // The fixture has no http(s) URLs, so the mirror pass declares the deck
  // fully offline-ready with zero mirrored assets — the success state we
  // want to exercise without depending on the network.
  const result = page.locator('.converter-panel__result');
  await expect(result).toContainText(/Offline ready/i);
});

test('surfaces converter errors for an unrecognised package', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();

  // tests/fixtures/sources contains plain-page.html which IS valid; build a
  // synthetic empty file by uploading sources index file path? Simpler: upload
  // an empty file by creating a Buffer-backed File via setInputFiles with an
  // explicit empty mime type.
  await page
    .getByTestId('converter-file-input')
    .setInputFiles({
      name: 'empty.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(''),
    });

  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();
  await expect(page.getByTestId('converter-error')).toBeVisible();
});
