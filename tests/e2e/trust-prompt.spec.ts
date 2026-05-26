import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const WC_FIXTURE = 'tests/fixtures/sources/huashu-webcomponent-deck.zip';

async function openConverter(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();
}

async function convertInWrapMode(page: Page, fixturePath: string): Promise<void> {
  await page.getByTestId('converter-file-input').setInputFiles(resolve(fixturePath));
  await page.locator('.converter-panel select').selectOption('wrap');
  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();
}

test('webcomponent wrap shows trust prompt; granting elevates the iframe sandbox', async ({
  page,
}) => {
  await page.goto('/');
  await openConverter(page);
  await convertInWrapMode(page, WC_FIXTURE);

  const prompt = page.getByTestId('trust-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('heading')).toHaveText(/huashu webcomponent deck/i);

  const caps = page.getByTestId('trust-prompt-caps').locator('[data-cap]');
  await expect(caps).toHaveCount(3);
  await expect(caps.nth(0)).toHaveAttribute('data-cap', 'broadcast-channel');
  await expect(caps.nth(1)).toHaveAttribute('data-cap', 'same-origin-storage');
  await expect(caps.nth(2)).toHaveAttribute('data-cap', 'window-open');

  await page.getByTestId('trust-prompt-grant').click();

  // Trust prompt closes and the deck enters the viewer.
  await expect(page.getByTestId('trust-prompt')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /huashu webcomponent deck/i })).toBeVisible();

  // The active iframe now has the elevated sandbox.
  const activeIframe = page.locator('iframe[data-active="true"]').first();
  const sandbox = await activeIframe.getAttribute('sandbox');
  const tokens = (sandbox ?? '').split(/\s+/).filter(Boolean);
  expect(tokens).toContain('allow-scripts');
  expect(tokens).toContain('allow-same-origin');
  expect(tokens).toContain('allow-popups');
  expect(tokens).toContain('allow-popups-to-escape-sandbox');

  // With `allow-same-origin` granted the iframe is no longer
  // opaque-origin, so the viewer drops `srcdoc` and points `src` at a
  // virtual `/__stage/<deckId>/...` URL that the Service Worker serves.
  // This is the path SW interception was built for; we assert both the
  // URL shape and that the slide content actually renders inside the
  // iframe (proving the SW round-trip is alive end-to-end).
  await expect(activeIframe).toHaveAttribute('src', /\/__stage\/[a-f0-9]+\//);
  await expect(activeIframe).not.toHaveAttribute('srcdoc', /./);
  const slideFrame = page.frameLocator('iframe[data-active="true"]').first();
  await expect(slideFrame.getByRole('heading', { name: 'WC 1' })).toBeVisible();
});

test('untrusted decks render via srcdoc — sandbox without allow-same-origin', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();
  const activeIframe = page.locator('iframe[data-active="true"]').first();

  // valid-basic.stage declares no `compat.requires`, so the iframe
  // stays at the `allow-scripts`-only baseline. Chrome treats it as
  // opaque-origin, so the SW can't intercept it. The viewer therefore
  // renders via srcdoc with all subresources inlined as data: URLs.
  const sandbox = await activeIframe.getAttribute('sandbox');
  expect(sandbox).toBe('allow-scripts');
  await expect(activeIframe).toHaveAttribute('srcdoc', /<!doctype html>/i);
  // src may still be present (DeckStage falls back to it when srcdoc
  // isn't supplied), but the active path is srcdoc — the slide HTML
  // must be inlined.
  const srcdoc = await activeIframe.getAttribute('srcdoc');
  expect(srcdoc).toContain('Lite Fixture Deck');
  expect(srcdoc).not.toMatch(/blob:/);
});

test('cancelling the trust prompt blocks the deck with E_TRUST_DENIED', async ({ page }) => {
  await page.goto('/');
  await openConverter(page);
  await convertInWrapMode(page, WC_FIXTURE);

  await expect(page.getByTestId('trust-prompt')).toBeVisible();
  await page.getByTestId('trust-prompt-cancel').click();

  await expect(page.getByTestId('trust-prompt')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('E_TRUST_DENIED');
  await expect(page.getByTestId('deck-viewer')).toHaveCount(0);
  await expect(page.getByTestId('presenter-view')).toHaveCount(0);
});

test('a granted deck is remembered for re-loads with the same fingerprint', async ({ page }) => {
  await page.goto('/');
  await openConverter(page);
  await convertInWrapMode(page, WC_FIXTURE);

  await expect(page.getByTestId('trust-prompt')).toBeVisible();
  await page.getByTestId('trust-prompt-grant').click();
  await expect(page.getByRole('heading', { name: /huashu webcomponent deck/i })).toBeVisible();

  // Reload preserves localStorage on the same origin; the persisted grant
  // should make the second convert skip the prompt entirely.
  await page.reload();
  await openConverter(page);
  await convertInWrapMode(page, WC_FIXTURE);

  await expect(page.getByRole('heading', { name: /huashu webcomponent deck/i })).toBeVisible();
  await expect(page.getByTestId('trust-prompt')).toHaveCount(0);

  const sandbox = await page.locator('iframe[data-active="true"]').first().getAttribute('sandbox');
  const tokens = (sandbox ?? '').split(/\s+/).filter(Boolean);
  expect(tokens).toContain('allow-same-origin');
});

test('decks without compat.requires never trigger a trust prompt', async ({ page }) => {
  await page.goto('/');
  await openConverter(page);
  await page
    .getByTestId('converter-file-input')
    .setInputFiles(resolve(WC_FIXTURE));
  // default mode = auto → webcomponent-deck splits, which produces no compat.requires.
  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();

  await expect(page.getByRole('heading', { name: /huashu webcomponent deck/i })).toBeVisible();
  await expect(page.getByTestId('trust-prompt')).toHaveCount(0);

  const sandbox = await page.locator('iframe[data-active="true"]').first().getAttribute('sandbox');
  expect(sandbox).toBe('allow-scripts');
});
