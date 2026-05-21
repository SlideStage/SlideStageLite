/**
 * Behavioural test for the I18nProvider — verifies the hook returns
 * translated strings, that switching the locale re-renders consumers,
 * persists the choice to localStorage, and mirrors onto <html lang>.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider, useI18n } from '@slidestage/lite-preset/i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '@slidestage/lite-preset/i18n/detect';

let container: HTMLDivElement;
let root: Root;

function Probe() {
  const { locale, setLocale, t, tFormat } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="brand">{t('app.brand.name')}</span>
      <span data-testid="meta">{t('app.header.meta')}</span>
      <span data-testid="formatted">
        {tFormat('viewer.title.current.live', { n: 3, label: 'Intro' })}
      </span>
      <button type="button" data-testid="to-zh" onClick={() => setLocale('zh-CN')}>
        zh
      </button>
      <button type="button" data-testid="to-en" onClick={() => setLocale('en')}>
        en
      </button>
    </div>
  );
}

function render(initial?: 'en' | 'zh-CN'): void {
  act(() => {
    root.render(
      <I18nProvider initialLocale={initial}>
        <Probe />
      </I18nProvider>,
    );
  });
}

function get(testId: string): string {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('I18nProvider', () => {
  it('renders English copy by default', () => {
    render('en');
    expect(get('locale')).toBe('en');
    expect(get('brand')).toBe('SlideStage Lite');
    expect(get('meta')).toBe('Local · no server');
    expect(get('formatted')).toBe('Slide 3: Intro');
    expect(document.documentElement.lang).toBe('en');
  });

  it('switching locale re-renders consumers, persists, and updates <html lang>', () => {
    render('en');
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="to-zh"]')!.click();
    });
    expect(get('locale')).toBe('zh-CN');
    expect(get('brand')).toBe('SlideStage Lite');
    expect(get('meta')).toBe('本地运行 · 无服务端');
    expect(get('formatted')).toBe('幻灯片 3：Intro');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });

  it('respects an injected initialLocale (bypasses detection)', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    render('zh-CN');
    expect(get('locale')).toBe('zh-CN');
    expect(get('meta')).toBe('本地运行 · 无服务端');
  });
});
