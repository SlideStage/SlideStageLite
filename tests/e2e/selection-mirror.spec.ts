import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * Presenter text selection ("划词") must mirror to the audience window, and
 * — like a native browser selection — must clear the moment the presenter
 * clicks elsewhere and the selection collapses.
 *
 * The capture happens inside the sandboxed slide iframe (runtime agent),
 * crosses the same-origin sync channel as `presentation.selection`, and is
 * painted by the audience-only `SelectionOverlay`. We drive a real mouse
 * drag/click so the whole native event path is exercised end to end.
 */
test('mirrors the presenter text selection to the audience and clears it on click', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();

  // Open the audience window (web popup) and wait until it has mirrored
  // slide 1 — the overlay is a sibling of the audience slide iframe.
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open audience window' }).click();
  const audience = await popupPromise;
  await expect(audience.getByTestId('audience-presenter-status')).toHaveText(/Linked/);
  await expect(audience.locator('iframe[title="Audience slide 1: Cover"]')).toBeAttached();

  // Nothing is highlighted yet, so the audience renders no selection overlay.
  await expect(audience.getByTestId('selection-overlay')).toHaveCount(0);

  // Drag across the cover heading inside the presenter's active slide iframe
  // to make a real text selection.
  const heading = page
    .frameLocator('iframe[title="Slide 1: Cover"]')
    .getByRole('heading', { name: 'Lite Fixture Deck' });
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + 4, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, midY, { steps: 8 });
  await page.mouse.up();

  // The audience paints the mirrored selection rect(s).
  await expect(audience.getByTestId('selection-overlay')).toBeVisible();
  await expect
    .poll(() => audience.getByTestId('selection-overlay').locator('rect').count())
    .toBeGreaterThan(0);

  // A plain click collapses the selection — exactly like a native browser —
  // and the mirrored highlight must vanish on the audience screen too.
  await page.mouse.click(box.x + 4, midY);
  await expect(audience.getByTestId('selection-overlay')).toHaveCount(0);

  await audience.close();
});
