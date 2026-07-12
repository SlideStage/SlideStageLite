import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

async function selectTool(page: Page, name: string): Promise<void> {
  await page.getByTestId('toolbar-handle').hover();
  await expect(page.getByTestId('presenter-toolbar')).toHaveAttribute('data-expanded', 'true');
  await page.getByTestId('presenter-toolbar').getByRole('button', { name, exact: true }).click();
}

test('renders the Lite landing page', async ({ page }) => {
  await page.goto('/');

  // Accepts both the legacy `SlideStageLite` and the current
  // `SlideStage Lite` brand title — the brand identity rollout in
  // `feat(brand): roll out SlideStage brand identity across runtime +
  // Tauri icons` introduced the space; the regex below stays robust to
  // either spelling so tooling that still rewrites the tag does not
  // silently break this smoke test.
  await expect(page).toHaveTitle(/SlideStage\s?Lite/);
  // Minimal "instant-tool" landing: brand header, one dropzone, and the
  // two secondary actions. No marketing hero, no benefit cards — those
  // live on slidestage.dev.
  await expect(page.getByTestId('app-header')).toBeVisible();
  await expect(page.getByTestId('open-deck-button')).toBeVisible();
  await expect(page.getByTestId('open-deck-button')).toContainText(
    /Open a \.stage deck/,
  );
  await expect(page.getByLabel(/Open \.stage/i)).toBeAttached();
  await expect(page.getByTestId('open-sample-button')).toBeVisible();
  await expect(page.getByTestId('converter-toggle')).toBeVisible();
});

test('landing dropzone shows the drag-over hint while a file is hovered', async ({
  page,
}) => {
  await page.goto('/');
  const dropzone = page.getByTestId('open-deck-button');
  await expect(dropzone).toContainText('Open a .stage deck');

  // Synthesize a `dragenter` from a fake DataTransfer so the React
  // onDragEnter / onDragOver handlers fire and flip the visual state.
  // We can't reuse setInputFiles here because the smoke deck-open test
  // already covers the file-picker path — this case specifically guards
  // the new drag affordance the instant-tool landing relies on.
  await dropzone.evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(
      new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }),
    );
    el.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: dt, bubbles: true }),
    );
  });

  await expect(dropzone).toContainText('Release to open');
  await expect(dropzone).toHaveClass(/is-drag-over/);

  // Leaving the dropzone reverts the idle headline + class.
  await dropzone.evaluate((el) => {
    el.dispatchEvent(
      new DragEvent('dragleave', {
        dataTransfer: new DataTransfer(),
        bubbles: true,
      }),
    );
  });

  await expect(dropzone).toContainText('Open a .stage deck');
  await expect(dropzone).not.toHaveClass(/is-drag-over/);
});

test('opens a local .stage deck', async ({ page }) => {
  await page.goto('/');

  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 2');
  await expect(page.getByTestId('deck-stage')).toBeVisible();
  await expect(page.getByTestId('presenter-side')).toBeVisible();
  await expect(page.getByTestId('presenter-timer')).toHaveText(/^\d{2}:\d{2}$/);

  const firstSlide = page.frameLocator('iframe[title="Slide 1: Cover"]');
  await expect(firstSlide.getByRole('heading', { name: 'Lite Fixture Deck' })).toBeVisible();

  await page.keyboard.press('S');
  await expect(page.getByText('Cover speaker notes from manifest.')).toBeVisible();

  await page.keyboard.press('O');
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  await page.getByRole('button', { name: /Details/ }).click();
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('2 / 2');

  await page.keyboard.press('Home');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 2');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('2 / 2');
  await expect(page.getByText('Details speaker notes from manifest.')).toBeVisible();

  await page.keyboard.press('Home');
  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('1 / 2');

  await page.getByRole('button', { name: 'next slide' }).click();

  await expect(page.getByRole('status', { name: 'Slide counter' })).toHaveText('2 / 2');
  await expect(page.getByText('Details speaker notes from manifest.')).toBeVisible();
  const secondSlide = page.frameLocator('iframe[title="Slide 2: Details"]');
  await expect(secondSlide.getByRole('heading', { name: 'Details Slide' })).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open audience window' }).click();
  const audience = await popupPromise;
  await expect(
    audience
      .frameLocator('iframe[title="Audience slide 2: Details"]')
      .getByRole('heading', { name: 'Details Slide' }),
  ).toBeVisible();
  await expect(audience.getByTestId('audience-presenter-status')).toHaveText(/Linked/);

  await expect(page.getByTestId('presenter-toolbar')).toHaveAttribute('data-expanded', 'false');
  await expect(page.getByTestId('toolbar-handle-label')).toHaveText('TOOLS');
  await selectTool(page, 'Pen');
  await expect(page.getByTestId('color-1')).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(page.getByTestId('presenter-toolbar')).toHaveAttribute('data-expanded', 'false');
  await expect(page.getByTestId('toolbar-handle-label')).toHaveText('PEN');
  await expect(page.getByTestId('toolbar-handle-color')).toBeVisible();
  const overlayBox = await page.getByTestId('annotation-overlay').boundingBox();
  expect(overlayBox).not.toBeNull();
  if (!overlayBox) {
    return;
  }
  await page.mouse.move(overlayBox.x + 60, overlayBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(overlayBox.x + 120, overlayBox.y + 100);
  await expect(audience.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);
  await page.mouse.move(overlayBox.x + 180, overlayBox.y + 140);
  await expect(audience.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);
  await expect(audience.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);

  await selectTool(page, 'Undo');
  await expect(page.getByTestId('annotation-overlay').locator('path')).toHaveCount(0);
  await expect(audience.getByTestId('annotation-overlay').locator('path')).toHaveCount(0);

  await page.mouse.move(overlayBox.x + 60, overlayBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(overlayBox.x + 180, overlayBox.y + 140);
  await page.mouse.up();
  await expect(page.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);

  await selectTool(page, 'Eraser');
  await page.mouse.click(overlayBox.x + 120, overlayBox.y + 100);
  await expect(page.getByTestId('annotation-overlay').locator('path')).toHaveCount(0);
  await expect(audience.getByTestId('annotation-overlay').locator('path')).toHaveCount(0);

  await selectTool(page, 'Pen');
  await page.mouse.move(overlayBox.x + 80, overlayBox.y + 90);
  await page.mouse.down();
  await page.mouse.move(overlayBox.x + 210, overlayBox.y + 150);
  await page.mouse.up();
  await expect(page.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);
  await expect(audience.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);

  await selectTool(page, 'Black');
  await expect(page.getByTestId('blackout-overlay')).toHaveClass(/black/);
  await expect(audience.getByTestId('blackout-overlay')).toHaveClass(/black/);
  await selectTool(page, 'White');
  await expect(page.getByTestId('blackout-overlay')).toHaveClass(/white/);
  await expect(audience.getByTestId('blackout-overlay')).toHaveClass(/white/);
  await selectTool(page, 'White');

  await selectTool(page, 'Laser');
  await page.mouse.move(overlayBox.x + 160, overlayBox.y + 120);
  await expect(audience.getByTestId('laser-pointer')).toBeVisible();

  await selectTool(page, 'Spotlight');
  await expect(page.getByTestId('spotlight-size-slider')).toBeVisible();
  await page.mouse.move(overlayBox.x + 200, overlayBox.y + 160);
  await expect(page.getByTestId('spotlight-mask')).toBeVisible();
  await expect(audience.getByTestId('spotlight-mask')).toBeVisible();

  await expect(page.getByTestId('open-audience')).toHaveText(/Live/);
  await audience.close();
  await expect(page.getByTestId('open-audience')).toHaveText(/Open audience window/);

  await page.reload();
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));
  await page.getByRole('button', { name: 'next slide' }).click();
  await expect(page.getByTestId('annotation-overlay').locator('path')).toHaveCount(1);
});

test('allows editing speaker notes locally and persists them', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByTestId('speaker-notes')).toContainText(
    'Cover speaker notes from manifest.',
  );

  await page.getByTestId('toggle-notes-edit').click();
  const editor = page.getByTestId('speaker-notes-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Lite custom cover note.');
  await page.getByTestId('toggle-notes-edit').click();

  await expect(page.getByTestId('speaker-notes')).toContainText('Lite custom cover note.');
  await expect(page.getByTestId('speaker-notes')).toContainText('edited locally');

  await page.reload();
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));
  await expect(page.getByTestId('speaker-notes')).toContainText('Lite custom cover note.');
  await expect(page.getByTestId('speaker-notes')).toContainText('edited locally');

  await page.getByTestId('reset-notes').click();
  await expect(page.getByTestId('speaker-notes')).toContainText(
    'Cover speaker notes from manifest.',
  );
  await expect(page.getByTestId('speaker-notes')).not.toContainText('edited locally');
});

test('toggles single window / presenter view modes and persists choice', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByTestId('presenter-view')).toBeVisible();
  await expect(page.getByTestId('open-single-view')).toBeVisible();

  await page.getByTestId('open-single-view').click();
  const deckViewer = page.getByTestId('deck-viewer');
  await expect(deckViewer).toBeVisible();
  await expect(deckViewer).toHaveAttribute('data-view-mode', 'single');
  await expect(page.getByTestId('open-presenter-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Speaker (S)' })).toBeVisible();

  await page.getByRole('button', { name: 'Speaker (S)' }).click();
  await expect(page.getByTestId('speaker-panel')).toBeVisible();
  await expect(page.getByTestId('next-deck-stage')).toBeVisible();
  await page.getByRole('button', { name: 'close speaker view' }).click();
  await expect(page.getByTestId('speaker-panel')).toHaveCount(0);

  const persisted = await page.evaluate(() => window.localStorage.getItem('slidestage-lite:view-mode'));
  expect(persisted).toBe('single');

  await page.reload();
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));
  await expect(page.getByTestId('deck-viewer')).toBeVisible();
  await expect(page.getByTestId('deck-viewer')).toHaveAttribute('data-view-mode', 'single');

  await page.getByTestId('open-presenter-view').click();
  await expect(page.getByTestId('presenter-view')).toBeVisible();
  await expect(page.getByTestId('presenter-view')).toHaveAttribute(
    'data-view-mode',
    'presenter',
  );
});

test('single window mode auto-hide toolbar reveals on bottom hover', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await page.getByTestId('open-single-view').click();
  await expect(page.getByTestId('deck-viewer')).toBeVisible();

  const toolbar = page.getByTestId('presenter-toolbar');
  await expect(toolbar).toHaveAttribute('data-mode', 'auto-hide');

  const host = page.getByTestId('presenter-host');
  const box = await host.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const targetX = box.x + box.width / 2;
  const targetY = box.y + box.height * 0.85;
  await page.mouse.move(targetX, targetY);

  await expect(toolbar).not.toHaveClass(/hidden/);
});

test('highlighter respects active color selection and spotlight uses dark mask', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  await expect(page.getByTestId('presenter-view')).toBeVisible();
  await selectTool(page, 'Highlighter');
  await page.getByTestId('presenter-toolbar').getByTestId('color-4').click();

  const overlayBox = await page.getByTestId('annotation-overlay').boundingBox();
  expect(overlayBox).not.toBeNull();
  if (!overlayBox) return;
  await page.mouse.move(overlayBox.x + 60, overlayBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(overlayBox.x + 220, overlayBox.y + 140, { steps: 4 });
  await page.mouse.up();

  const stroke = page.getByTestId('annotation-overlay').locator('path').first();
  await expect(stroke).toHaveCount(1);
  const strokeColor = await stroke.getAttribute('stroke');
  expect(strokeColor?.toLowerCase()).toContain('0a84ff');

  await selectTool(page, 'Spotlight');
  const mask = page.getByTestId('spotlight-mask');
  await expect(mask).toBeVisible();
  const bg = await mask.evaluate((el) => (el as HTMLElement).style.background);
  expect(bg).toContain('radial-gradient');
  expect(bg).toContain('transparent');
  expect(bg).toContain('rgba(0, 0, 0, 0.85)');
});

test('Shift+S selects spotlight instead of toggling the speaker panel', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  // Single-window mode is where the S (speaker panel) shortcut has a
  // visible effect, so the historical Shift+S double-fire (spotlight AND
  // speaker panel) is observable here.
  await page.getByTestId('open-single-view').click();
  await expect(page.getByTestId('deck-viewer')).toBeVisible();
  await expect(page.getByTestId('speaker-panel')).toHaveCount(0);

  await page.keyboard.press('Shift+S');
  await expect(page.getByTestId('tool-spotlight')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('speaker-panel')).toHaveCount(0);

  // Modifier combos stay with the browser — Alt+O must not open the
  // overview overlay.
  await page.keyboard.press('Alt+o');
  await expect(page.getByRole('region', { name: 'Overview' })).toHaveCount(0);

  // The documented plain keys still work.
  await page.keyboard.press('Escape'); // spotlight → mouse
  await page.keyboard.press('s');
  await expect(page.getByTestId('speaker-panel')).toBeVisible();
});

test('persists side / notes resize across reloads', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));

  const view = page.getByTestId('presenter-view');
  await expect(view).toBeVisible();

  const initialSideWidth = await view.evaluate(
    (el) => getComputedStyle(el).getPropertyValue('--side-w').trim() || '360px',
  );
  expect(initialSideWidth).toBe('360px');

  const resizer = page.getByTestId('presenter-side-resizer');
  const box = await resizer.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 80, startY, { steps: 6 });
  await page.mouse.up();

  await expect
    .poll(() =>
      view.evaluate((el) =>
        Number.parseInt(getComputedStyle(el).getPropertyValue('--side-w').trim(), 10),
      ),
    )
    .toBeGreaterThan(400);

  const notesResizer = page.getByTestId('presenter-notes-resizer');
  const notesBox = await notesResizer.boundingBox();
  expect(notesBox).not.toBeNull();
  if (!notesBox) return;

  const nstartX = notesBox.x + notesBox.width / 2;
  const nstartY = notesBox.y + notesBox.height / 2;
  await page.mouse.move(nstartX, nstartY);
  await page.mouse.down();
  await page.mouse.move(nstartX, nstartY - 60, { steps: 6 });
  await page.mouse.up();

  await expect
    .poll(() =>
      view.evaluate((el) =>
        Number.parseInt(getComputedStyle(el).getPropertyValue('--notes-h').trim(), 10),
      ),
    )
    .toBeGreaterThan(200);

  const persistedSide = await page.evaluate(() => window.localStorage.getItem('slidestage-lite:side-w'));
  const persistedNotes = await page.evaluate(() => window.localStorage.getItem('slidestage-lite:notes-h'));
  expect(Number(persistedSide)).toBeGreaterThan(400);
  expect(Number(persistedNotes)).toBeGreaterThan(200);

  await page.reload();
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/valid-basic.stage'));
  const restored = page.getByTestId('presenter-view');
  await expect(restored).toBeVisible();
  await expect
    .poll(() =>
      restored.evaluate((el) =>
        Number.parseInt(getComputedStyle(el).getPropertyValue('--side-w').trim(), 10),
      ),
    )
    .toBe(Number(persistedSide));
  await expect
    .poll(() =>
      restored.evaluate((el) =>
        Number.parseInt(getComputedStyle(el).getPropertyValue('--notes-h').trim(), 10),
      ),
    )
    .toBe(Number(persistedNotes));
});
