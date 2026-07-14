import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * In-place slide text editing, end to end:
 *   1. Toggle edit mode, click the cover heading inside the sandboxed
 *      slide iframe, retype it, commit with Enter.
 *   2. Leaving edit mode silently reloads the deck (same fingerprint) —
 *      the patched heading must render in the fresh iframe.
 *   3. The patch persists: after a full page reload + reopen of the SAME
 *      file the edit is still applied at load time.
 *   4. "Export copy" downloads a `<name>.edited.stage` whose bytes open
 *      as a standalone deck carrying the edited text (and no stored-edit
 *      warnings, since the copy is a brand-new fingerprint).
 *   5. "Discard edits" restores the original text everywhere.
 */

const FIXTURE = 'tests/fixtures/valid-basic.stage';
const EDITED_TITLE = 'Edited Cover Title';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel(/Open \.stage/i).setInputFiles(resolve(FIXTURE));
  await expect(page.getByTestId('presenter-view')).toBeVisible();
}

function coverFrame(page: Page) {
  return page.frameLocator('iframe[title="Slide 1: Cover"]');
}

test('edits slide text in place, persists it, and exports a working copy', async ({
  page,
}) => {
  await openFixture(page);
  const heading = coverFrame(page).getByRole('heading', { name: 'Lite Fixture Deck' });
  await expect(heading).toBeVisible();

  // --- 1. Edit the heading in place -----------------------------------
  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('edit-mode-hint')).toBeVisible();

  await heading.click();
  await expect(heading).toHaveAttribute('contenteditable', /plaintext-only|true/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(EDITED_TITLE);
  await page.keyboard.press('Enter');

  // The committed edit reaches the host: export/discard controls appear.
  await expect(page.getByTestId('export-edited')).toBeVisible();
  await expect(page.getByTestId('discard-edits')).toBeVisible();

  // --- 2. Exit edit mode → silent reload shows the patched HTML -------
  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('edit-mode-hint')).toHaveCount(0);
  await expect(
    coverFrame(page).getByRole('heading', { name: EDITED_TITLE }),
  ).toBeVisible();
  // Same deck identity: no trust prompt, no edit-failure notice.
  await expect(page.getByTestId('edits-failed-notice')).toHaveCount(0);

  // Untouched sibling content survives the patch.
  await expect(
    coverFrame(page).getByText('Slide 1 rendered from a local .stage file.'),
  ).toBeVisible();

  // --- 3. The patch persists across a full reopen ---------------------
  await page.reload();
  await page.getByLabel(/Open \.stage/i).setInputFiles(resolve(FIXTURE));
  await expect(
    coverFrame(page).getByRole('heading', { name: EDITED_TITLE }),
  ).toBeVisible();
  await expect(page.getByTestId('edits-failed-notice')).toHaveCount(0);
  await expect(page.getByTestId('export-edited')).toBeVisible();

  // --- 4. Export a copy and open it as a standalone deck --------------
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-edited').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('valid-basic.edited.stage');
  const dir = await mkdtemp(join(tmpdir(), 'slidestage-edit-e2e-'));
  const copyPath = join(dir, download.suggestedFilename());
  await download.saveAs(copyPath);

  await page.reload();
  await page.getByLabel(/Open \.stage/i).setInputFiles(copyPath);
  await expect(page.getByTestId('presenter-view')).toBeVisible();
  // The copy carries the edit baked into its slide HTML...
  await expect(
    coverFrame(page).getByRole('heading', { name: EDITED_TITLE }),
  ).toBeVisible();
  // ...as a NEW file: no local edits attach to its fresh fingerprint.
  await expect(page.getByTestId('export-edited')).toHaveCount(0);
  await expect(page.getByTestId('edits-failed-notice')).toHaveCount(0);

  // --- 5. Discard edits on the original restores the source text ------
  await page.reload();
  await page.getByLabel(/Open \.stage/i).setInputFiles(resolve(FIXTURE));
  await expect(
    coverFrame(page).getByRole('heading', { name: EDITED_TITLE }),
  ).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('discard-edits').click();
  await expect(
    coverFrame(page).getByRole('heading', { name: 'Lite Fixture Deck' }),
  ).toBeVisible();
  await expect(page.getByTestId('export-edited')).toHaveCount(0);
  const stored = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('slidestage-lite:edits:')),
  );
  expect(stored).toEqual([]);
});

test('Escape cancels an in-flight edit without recording a patch', async ({ page }) => {
  await openFixture(page);
  const heading = coverFrame(page).getByRole('heading', { name: 'Lite Fixture Deck' });

  await page.getByTestId('edit-toggle').click();
  await heading.click();
  await expect(heading).toHaveAttribute('contenteditable', /plaintext-only|true/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Discarded draft');
  await page.keyboard.press('Escape');

  // Original text restored in the live DOM, no patch recorded.
  await expect(
    coverFrame(page).getByRole('heading', { name: 'Lite Fixture Deck' }),
  ).toBeVisible();
  await expect(page.getByTestId('export-edited')).toHaveCount(0);

  // Leaving edit mode without changes must not reload or mark the deck.
  await page.getByTestId('edit-toggle').click();
  await expect(
    coverFrame(page).getByRole('heading', { name: 'Lite Fixture Deck' }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('slidestage-lite:edits:')),
  );
  expect(stored).toEqual([]);
});
