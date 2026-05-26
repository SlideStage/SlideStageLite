import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('rewrites srcdoc/img/css inline references to inline data: URLs', async ({ page }) => {
  await page.goto('/');

  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/tricky-assets.stage'));

  await expect(page.getByRole('heading', { name: 'Tricky Assets Deck' })).toBeVisible();
  const slideFrame = page.frameLocator('iframe[title="Slide 1: Tricky"]');

  // The Web build now ships every slide via srcdoc with each subresource
  // inlined as a data: URL — sandboxed iframes have an opaque origin
  // and so cannot be controlled by the service worker, and Chrome
  // 131+ partitions parent blob: URLs away from opaque-origin iframes.
  // The previous blob: URL assertions are therefore obsolete; we check
  // that the inlined data: URLs survive the rewrite intact instead.

  // 1. Direct <img src="../shared/pixel.png"> is rewritten to a data URL.
  const directImg = slideFrame.locator('#direct-img');
  await expect(directImg).toBeVisible();
  const directSrc = await directImg.getAttribute('src');
  expect(directSrc).toMatch(/^data:image\/png;base64,/);

  // 2. <iframe srcdoc> inside the slide has its inner <img> rewritten too.
  const innerFrame = slideFrame.frameLocator('iframe[title="inner-frame"]');
  const innerImg = innerFrame.locator('#srcdoc-img');
  await expect(innerImg).toBeAttached();
  const innerSrc = await innerImg.getAttribute('src');
  expect(innerSrc).toMatch(/^data:image\/png;base64,/);

  // 3. The inlined <link rel="stylesheet" href="../shared/theme.css"> became a
  //    <style data-slidestage-inline-css> tag whose body references the
  //    bundled font/background as data: URLs. The @import target was
  //    recursively spliced into the parent CSS body (not left as a
  //    `@import "data:..."` URL) so any sibling-relative url() refs
  //    inside the imported file resolve correctly — data: URLs have
  //    no base, so leaving the @import as a data: URL would orphan
  //    every `url("../font/...")` declaration inside.
  const inlinedStyle = slideFrame.locator('style[data-slidestage-inline-css="shared/theme.css"]');
  await expect(inlinedStyle).toHaveCount(1);
  const inlinedBody = await inlinedStyle.textContent();
  expect(inlinedBody).not.toContain('@import "data:');
  expect(inlinedBody).not.toContain('@import url(');
  expect(inlinedBody).toContain('slidestage:inlined @import');
  expect(inlinedBody).toContain('url("data:');

  // 4. <style>@import url("../shared/extra.css")</style> in slide HTML is
  //    spliced inline too — the body of extra.css ends up directly in
  //    the slide's <style> block, so the rules it declares survive
  //    (here: the `--accent` CSS variable and the `.tricky` ruleset).
  const styleBlock = slideFrame.locator('head > style:not([data-slidestage-inline-css])');
  const styleText = await styleBlock.first().textContent();
  expect(styleText).toContain('slidestage:inlined @import shared/extra.css');
  expect(styleText).not.toContain('@import url(');
  expect(styleText).toContain('--accent: #1783ff');

  // 5. External Google Fonts links survive the rewrite — they must not
  //    be silently stripped (regression: stripExternalLinkReferences
  //    was previously applied unconditionally and ate CDN typography on
  //    Web srcdoc decks). The link is downgraded to media="print" so
  //    first paint isn't blocked, then onload swaps it back to "all".
  //
  // We assert on the immutable `onload` attribute (not `media`)
  // because `media` is set to `"print"` initially and then swapped to
  // `"all"` once the CDN response lands — a race condition we don't
  // want to chase. The presence of the onload handler is the proof
  // that the deferral rewrite ran.
  const fontLink = slideFrame.locator(
    'link[rel="stylesheet"][href*="fonts.googleapis.com"]',
  );
  await expect(fontLink).toHaveCount(1);
  await expect(fontLink).toHaveAttribute('onload', /this\.media='all'/);
  // preconnect is left untouched — only the stylesheet is deferred.
  const preconnect = slideFrame.locator(
    'link[rel="preconnect"][href="https://fonts.gstatic.com"]',
  );
  await expect(preconnect).toHaveCount(1);
});
