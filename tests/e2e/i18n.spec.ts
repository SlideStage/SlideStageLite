import { expect, test } from '@playwright/test';

test.describe('i18n', () => {
  test('defaults to English when no preference is stored', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('open-deck-button')).toContainText(
      /Open a \.stage deck/,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('language-switcher-en')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('honours ?lang=zh-CN URL override on first load', async ({ page }) => {
    await page.goto('/?lang=zh-CN');

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByTestId('open-deck-button')).toContainText(
      /打开 \.stage 演示包/,
    );
    await expect(page.getByTestId('language-switcher-zh-CN')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('switching the language updates copy, persists choice, and survives reload', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('open-deck-button')).toContainText(
      /Open a \.stage deck/,
    );

    await page.getByTestId('language-switcher-zh-CN').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByTestId('open-deck-button')).toContainText(
      /打开 \.stage 演示包/,
    );
    // The same status string is rendered in both the header chip and the
    // landing-page footer status pill; scope to a single testid so we don't
    // trip Playwright's strict-mode "multiple matches" check.
    await expect(page.getByTestId('app-footer-status')).toContainText(
      '本地运行 · 无服务端',
    );

    const storedLocale = await page.evaluate(() =>
      window.localStorage.getItem('slidestage-lite:locale'),
    );
    expect(storedLocale).toBe('zh-CN');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByTestId('open-deck-button')).toContainText(
      /打开 \.stage 演示包/,
    );
    await expect(
      page.getByRole('button', { name: '转换 HTML 演示' }),
    ).toBeVisible();
  });

  test('Chinese landing renders translated dropzone copy and secondary actions', async ({ page }) => {
    await page.goto('/?lang=zh-CN');

    await expect(page.getByTestId('open-deck-button')).toContainText(
      /打开 \.stage 演示包/,
    );
    await expect(page.getByTestId('open-deck-button')).toContainText(
      /把 \.stage 文件拖到此处/,
    );
    await expect(page.getByTestId('open-sample-button')).toContainText(
      '打开示例演示',
    );
    await expect(page.getByTestId('converter-toggle')).toContainText(
      '转换 HTML 演示',
    );
  });
});
