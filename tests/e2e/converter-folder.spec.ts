import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const FOLDER_FIXTURE = resolve('tests/fixtures/folders/inline-deck');

test('converts a folder via the SPA folder picker and loads the .stage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();
  await expect(page.getByRole('heading', { name: 'Convert from HTML deck' })).toBeVisible();

  await page.getByTestId('converter-folder-input').setInputFiles(FOLDER_FIXTURE);

  await expect(page.getByTestId('converter-selection')).toContainText('inline-deck/');
  // node_modules/foo/index.js and .DS_Store must have been filtered out before counting.
  await expect(page.getByTestId('converter-selection')).toContainText('3 files');

  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Folder Inline Deck' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 2');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('2 / 2');

  const slide2 = page.frameLocator('iframe[title="Slide 2: Folder two"]');
  await expect(slide2.locator('section.slide h1')).toHaveText('Folder two');
});

test('dropping a single .html file routes through the converter drop zone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Convert from HTML deck/ }).click();

  const htmlPath = resolve('tests/fixtures/folders/inline-deck/index.html');
  const html = await readFile(htmlPath, 'utf-8');

  await page.evaluate(
    ({ name, type, content }) => {
      const dataTransfer = new DataTransfer();
      const file = new File([content], name, { type });
      dataTransfer.items.add(file);
      const dropTarget = document.querySelector('[data-testid="converter-drop"]')!;
      dropTarget.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
      );
      dropTarget.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      );
    },
    { name: 'index.html', type: 'text/html', content: html },
  );

  // The drop should populate the file branch — assets are missing so the
  // CSS link will be skipped, but the deck still converts successfully.
  await expect(page.getByTestId('converter-selection')).toContainText('index.html');

  await page.getByRole('button', { name: 'Convert & Load', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Folder Inline Deck' })).toBeVisible();
});
