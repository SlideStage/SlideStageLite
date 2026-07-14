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
  // Unexported session edits arm a beforeunload prompt; accepting it lets
  // the mid-test reloads proceed. (Registering ANY dialog listener turns
  // off Playwright's auto-dismiss, so the discard confirm() below is
  // accepted explicitly by its own once-handler.)
  let beforeUnloadPrompts = 0;
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') {
      beforeUnloadPrompts += 1;
      void dialog.accept();
    }
  });
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
  // The reload leaves unexported session edits behind, so the unsaved
  // guard must raise a (accepted above) beforeunload prompt.
  await page.reload();
  expect(beforeUnloadPrompts).toBe(1);
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

test('edits one text run of a mixed-font paragraph without touching siblings', async ({
  page,
}) => {
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') void dialog.accept();
  });
  await openFixture(page);
  const frame = coverFrame(page);
  const tagline = frame.locator('p.tagline');
  await expect(tagline).toHaveText('Mixed intro styled run tail text');

  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('edit-mode-hint')).toBeVisible();

  // Click on the LEADING run ("Mixed intro ") — the paragraph itself is
  // mixed content, so the old leaf-only editor ignored it entirely.
  const box = await tagline.boundingBox();
  if (!box) throw new Error('tagline not laid out');
  await tagline.click({ position: { x: 10, y: box.height / 2 } });

  // The run is wrapped in a temporary editable span.
  const wrap = frame.locator('[data-slidestage-editwrap]');
  await expect(wrap).toHaveAttribute('contenteditable', /plaintext-only|true/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Rewritten intro ');
  await page.keyboard.press('Enter');

  // Commit unwraps the span and records the patch on the host.
  await expect(frame.locator('[data-slidestage-editwrap]')).toHaveCount(0);
  await expect(page.getByTestId('export-edited')).toBeVisible();
  await expect(tagline).toHaveText('Rewritten intro styled run tail text');
  // The styled sibling run is untouched.
  await expect(tagline.locator('strong')).toHaveText('styled run');

  // Exit edit mode → silent reload applies the patch at load time.
  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('edit-mode-hint')).toHaveCount(0);
  await expect(coverFrame(page).locator('p.tagline')).toHaveText(
    'Rewritten intro styled run tail text',
  );
  await expect(coverFrame(page).locator('p.tagline strong')).toHaveText('styled run');
  await expect(page.getByTestId('edits-failed-notice')).toHaveCount(0);

  // Clean up so later tests start from pristine storage.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('discard-edits').click();
  await expect(coverFrame(page).locator('p.tagline')).toHaveText(
    'Mixed intro styled run tail text',
  );
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
