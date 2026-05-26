import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

interface SourceCase {
  fileName: string;
  fixturePath: string;
  /** The deck title that should appear in the viewer header after load. */
  expectedTitle: RegExp | string;
  /** Slide counter value after the deck is loaded (1-based / total). */
  expectedCounter: string;
  /** Iframe title for slide 1 used to drill into the rendered slide markup. */
  firstSlideIframeTitle: string;
  /**
   * Selector + text we expect inside the first slide. Proves the converter
   * preserved content correctly, not just the slide count.
   */
  firstSlideAssertion: { locator: string; text: RegExp | string };
}

const sourceCases: SourceCase[] = [
  {
    fileName: 'html-ppt-inline-deck.zip',
    fixturePath: 'tests/fixtures/sources/html-ppt-inline-deck.zip',
    expectedTitle: /html-ppt-skill flavored deck/i,
    expectedCounter: '1 / 3',
    firstSlideIframeTitle: 'Slide 1: Cover',
    firstSlideAssertion: { locator: 'section.slide h1', text: 'Inline 1' },
  },
  {
    fileName: 'huashu-webcomponent-deck.zip',
    fixturePath: 'tests/fixtures/sources/huashu-webcomponent-deck.zip',
    expectedTitle: /huashu webcomponent deck/i,
    expectedCounter: '1 / 2',
    firstSlideIframeTitle: 'Slide 1: WC 1',
    firstSlideAssertion: { locator: 'deck-slide h1', text: 'WC 1' },
  },
  {
    fileName: 'huashu-router.zip',
    fixturePath: 'tests/fixtures/sources/huashu-router.zip',
    expectedTitle: /huashu router deck/i,
    expectedCounter: '1 / 3',
    firstSlideIframeTitle: 'Slide 1: Cover',
    firstSlideAssertion: { locator: 'h1', text: 'Router 1' },
  },
  {
    fileName: 'plain-page.html',
    fixturePath: 'tests/fixtures/sources/plain-page.html',
    expectedTitle: /Plain Single Page/i,
    expectedCounter: '1 / 1',
    firstSlideIframeTitle: 'Slide 1: Plain Single Page',
    firstSlideAssertion: { locator: 'h1', text: 'Plain HTML' },
  },
];

async function convertAndLoad(page: Page, fixturePath: string): Promise<void> {
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();
  await page
    .getByTestId('converter-file-input')
    .setInputFiles(resolve(fixturePath));
  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();
}

for (const sourceCase of sourceCases) {
  test(`round-trips ${sourceCase.fileName}: converter SPA → loader → first slide renders`, async ({
    page,
  }) => {
    await page.goto('/');
    await convertAndLoad(page, sourceCase.fixturePath);

    await expect(page.getByRole('heading', { name: sourceCase.expectedTitle })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText(
      sourceCase.expectedCounter,
    );

    const frame = page.frameLocator(`iframe[title="${sourceCase.firstSlideIframeTitle}"]`);
    await expect(frame.locator(sourceCase.firstSlideAssertion.locator).first()).toHaveText(
      sourceCase.firstSlideAssertion.text,
    );
  });
}

test('round-trips an existing .stage (passthrough) via the SPA', async ({ page }) => {
  await page.goto('/');
  await convertAndLoad(page, 'tests/fixtures/valid-basic.stage');

  await expect(page.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 2');

  const frame = page.frameLocator('iframe[title="Slide 1: Cover"]');
  await expect(frame.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();
});
