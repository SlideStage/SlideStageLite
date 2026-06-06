import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Export PDF downloads a real, multi-page PDF from the deck', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();

  const exportButton = page.getByTestId('export-pdf');
  await expect(exportButton).toBeEnabled();

  // The web flow saves via a transient <a download>, which Playwright
  // surfaces as a download event. Full-resolution foreignObject capture +
  // pdf-lib assembly run client-side, so give it generous headroom.
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path);
  // Valid PDF magic header + EOF marker.
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.subarray(-6).toString('latin1')).toContain('%%EOF');

  // The off-screen capture worker must be torn down once export finishes.
  await expect(page.locator('iframe[title="pdf-export-capture-worker"]')).toHaveCount(0);
});
