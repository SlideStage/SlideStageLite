import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('Overview backfills missing thumbnails from on-demand capture', async ({ page }) => {
  // The capture pipeline is gated behind isTauri() in production; the
  // dev-only `__slidestageForceThumbnailCapture` flag flips it on inside
  // chromium so we can exercise the foreignObject rasterizer end-to-end.
  await page.addInitScript(() => {
    (window as Window & { __slidestageForceThumbnailCapture?: boolean })
      .__slidestageForceThumbnailCapture = true;
  });

  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();

  // Open the Overview grid — every slide should eventually swap its
  // numeric placeholder for a real <img src="blob:..."> filled by
  // the headless capture pass.
  await page.keyboard.press('O');
  const overview = page.getByRole('region', { name: 'Overview' });
  await expect(overview).toBeVisible();

  const cards = overview.locator('.overview-card');
  await expect(cards).toHaveCount(2);

  for (let i = 0; i < 2; i += 1) {
    const card = cards.nth(i);
    const img = card.locator('img');
    await expect(img).toHaveCount(1, { timeout: 15_000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^blob:/);
  }

  // The capture worker iframe is mounted off-screen during the run and
  // removed on completion. By the time both thumbnails are in the DOM,
  // the worker must already be torn down.
  await expect(
    page.locator('iframe[title="thumbnail-capture-worker"]'),
  ).toHaveCount(0);
});
