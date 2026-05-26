// Regression: 146 MB CJK-font decks crashed the renderer because the
// loader's `createDataUrls()` base64-encoded every asset upfront. The
// fix is `inlineMode: 'auto'` (Web): once a deck exceeds the inline
// budget, the loader skips the data: URL pass and App.tsx auto-grants
// `same-origin-storage` so the slide can render via the SW transport
// (which doesn't pay the base64 cost). A sticky banner tells the
// user the deck was auto-elevated.
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('oversized deck auto-elevates to same-origin and renders via SW (no srcdoc)', async ({
  page,
}) => {
  // Track every font/blob request the iframe makes so we can prove no
  // base64-inlined `data:font/...` payloads ended up in the srcdoc
  // (the OOM signature).
  const networkLog: Array<{ url: string; status: number | null }> = [];
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.startsWith('blob:') || /\.(ttf|otf|woff2?|eot)(\?|#|$)/i.test(url) || url.includes('/__stage/')) {
      networkLog.push({
        url: url.length > 140 ? `${url.slice(0, 137)}...` : url,
        status: resp.status(),
      });
    }
  });

  await page.goto('/');

  // Wait for the SW to register before loading the deck — the auto-
  // elevation path requires the SW to be active.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/oversized.stage'));

  // 1. Sticky banner appears explaining the auto-elevation.
  const notice = page.getByTestId('auto-elevated-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/MB/);
  // The banner mentions "same-origin" so the user understands the
  // posture change. (The exact wording lives in `messages.ts` —
  // keying off the substring keeps the test resilient to copy edits.)
  await expect(notice).toContainText(/same-origin/i);

  // 2. The slide IS visible (i.e. the renderer did not OOM and the
  //    iframe loaded via the SW route instead of an empty srcdoc).
  const slideFrame = page.frameLocator('iframe[title^="Slide 1"]').first();
  await expect(slideFrame.getByText('Oversized Deck')).toBeVisible({ timeout: 15_000 });

  // 3. The iframe's sandbox now includes `allow-same-origin` — the
  //    proof that the auto-elevation actually flipped the trust
  //    capability. We check via the live `sandbox` attribute on the
  //    iframe element (Playwright can't introspect cross-realm
  //    `iframeSandbox` state otherwise).
  const sandboxValue = await page
    .locator('iframe[title^="Slide 1"]')
    .first()
    .getAttribute('sandbox');
  expect(sandboxValue).toContain('allow-scripts');
  expect(sandboxValue).toContain('allow-same-origin');

  // 4. The iframe loaded from a same-origin virtual URL (not srcdoc).
  const srcValue = await page
    .locator('iframe[title^="Slide 1"]')
    .first()
    .getAttribute('src');
  expect(srcValue, 'oversized deck must mount via src, not srcdoc').toMatch(
    /\/__stage\/[a-f0-9]+\/slides\/01-cover\.html$/,
  );
  // srcdoc is not in use (the loader filled it with a placeholder so
  // forcing srcdoc would render an empty slide). The attribute
  // should literally be missing.
  const srcdocValue = await page
    .locator('iframe[title^="Slide 1"]')
    .first()
    .getAttribute('srcdoc');
  expect(srcdocValue, 'srcdoc should be absent — viewer guard fired').toBeNull();

  // 5. Network: at least one /__stage/ asset must have flowed (proof
  //    the SW is doing the work). And NO blob: URLs (those are the
  //    pre-fix OOM signal — Chrome 131+ blocks them in opaque-origin
  //    iframes anyway).
  expect(networkLog.some((entry) => entry.url.includes('/__stage/'))).toBe(true);
  expect(networkLog.some((entry) => entry.url.startsWith('blob:'))).toBe(false);

  // 6. The dismiss button hides the banner.
  await notice.getByRole('button').click();
  await expect(notice).toHaveCount(0);
});

test('oversized deck: audience popup also mounts via SW (mirrors presenter sandbox)', async ({
  page,
}) => {
  // Regression: the audience window used to recompute its iframe
  // sandbox from `manifest.compat.requires`. For auto-elevated decks
  // (no declared caps; the App layer silently granted
  // `same-origin-storage`), that recompute landed at `allow-scripts`
  // only — opaque origin, SW bypassed, popup blank. The fix ships
  // the resolved sandbox token over the snapshot envelope so the
  // audience exactly mirrors the presenter.
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/oversized.stage'));

  await expect(page.getByTestId('auto-elevated-notice')).toBeVisible();
  await expect(page.frameLocator('iframe[title^="Slide 1"]').first().getByText('Oversized Deck'))
    .toBeVisible({ timeout: 15_000 });

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /Open audience window/i }).click();
  const audience = await popupPromise;

  // Audience iframe must:
  //  (a) actually appear (presenter shipped the snapshot);
  //  (b) mount via `src`, not srcdoc (oversized → inlinedHtmlAvailable=false);
  //  (c) inherit `allow-same-origin` so the SW can intercept.
  const audienceIframe = audience.locator('iframe[title^="Audience slide 1"]').first();
  await expect(audienceIframe).toBeAttached({ timeout: 10_000 });
  // Wait for the snapshot to be applied (sandbox is set on mount).
  await expect
    .poll(async () => audienceIframe.getAttribute('sandbox'), { timeout: 10_000 })
    .toContain('allow-same-origin');
  const audSrc = await audienceIframe.getAttribute('src');
  expect(audSrc).toMatch(/\/__stage\/[a-f0-9]+\/slides\/01-cover\.html$/);
  const audSrcdoc = await audienceIframe.getAttribute('srcdoc');
  expect(audSrcdoc).toBeNull();
  // Slide content actually renders inside the audience iframe.
  await expect(
    audience.frameLocator('iframe[title^="Audience slide 1"]').first().getByText('Oversized Deck'),
  ).toBeVisible({ timeout: 10_000 });
});

test('oversized deck error path: failing SW registration surfaces a friendly E_TOO_LARGE_FOR_INLINE message', async ({
  page,
}) => {
  // Simulate an environment where the SW container exists (so the SPA
  // module loads cleanly) but every register() call rejects. The
  // loader then can't acquire a transport, hits the
  // `inlineMode='auto' + oversized + no transport` branch, and bubbles
  // up the localized error.
  await page.addInitScript(() => {
    const original = navigator.serviceWorker;
    if (!original) return;
    const stub: Partial<ServiceWorkerContainer> = {
      register: () => Promise.reject(new Error('SW disabled for this test')),
      // getRegistration is consulted by the SW client; null = "no SW"
      getRegistration: () => Promise.resolve(undefined),
      // `ready` never resolves; downstream awaits gate on register().
      ready: new Promise<ServiceWorkerRegistration>(() => {}),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => stub as ServiceWorkerContainer,
    });
  });

  await page.goto('/');
  await page
    .getByLabel(/Open \.stage/i)
    .setInputFiles(resolve('tests/fixtures/oversized.stage'));

  const errorBanner = page.getByTestId('status-error');
  await expect(errorBanner).toBeVisible({ timeout: 15_000 });
  // The localized E_TOO_LARGE_FOR_INLINE copy mentions the error code
  // and suggests using Chrome / desktop app — assert on the code so
  // copy can change without breaking the test.
  await expect(errorBanner).toContainText('E_TOO_LARGE_FOR_INLINE');

  // No banner — auto-elevation never fired because there was no
  // transport to elevate into.
  await expect(page.getByTestId('auto-elevated-notice')).toHaveCount(0);
});
