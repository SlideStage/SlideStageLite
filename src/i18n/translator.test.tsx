/**
 * Contract tests for `@slidestage/ui/i18n/translator`.
 *
 * Three concerns this file locks in:
 *   1. The identity fallback returns each key unchanged so isolated UI tests
 *      and boot-time renders stay legible without a provider.
 *   2. `tFormat` does `{name}` placeholder substitution even when the
 *      identity translator is the only thing mounted.
 *   3. `UiTranslatorProvider` actually overrides the identity default so
 *      Lite-preset's `<I18nProvider>` can inject real translations.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UiTranslatorProvider,
  useUiTranslator,
  type UiTranslator,
} from '@slidestage/ui/i18n/translator';

afterEach(() => {
  cleanup();
});

function Probe() {
  const { t, tFormat } = useUiTranslator();
  return (
    <div>
      <span data-testid="t-out">{t('toolbar.tool.pen')}</span>
      <span data-testid="tf-out">{tFormat('hello.{name}', { name: 'Alice' })}</span>
    </div>
  );
}

describe('UiTranslator identity fallback', () => {
  it('returns each key unchanged when no provider is mounted', () => {
    render(<Probe />);
    expect(screen.getByTestId('t-out').textContent).toBe('toolbar.tool.pen');
  });

  it('still applies {name} substitution under tFormat', () => {
    render(<Probe />);
    expect(screen.getByTestId('tf-out').textContent).toBe('hello.Alice');
  });

  it('substitutes numeric vars and leaves unmatched placeholders alone', () => {
    function NumProbe() {
      const { tFormat } = useUiTranslator();
      return (
        <>
          <span data-testid="num">{tFormat('count {n}', { n: 7 })}</span>
          <span data-testid="missing">{tFormat('hi {a} {b}', { a: 'x' })}</span>
        </>
      );
    }
    render(<NumProbe />);
    expect(screen.getByTestId('num').textContent).toBe('count 7');
    expect(screen.getByTestId('missing').textContent).toBe('hi x {b}');
  });
});

describe('UiTranslatorProvider', () => {
  it('overrides the identity default with the injected translator', () => {
    const inject: UiTranslator = {
      t: (key) => (key === 'toolbar.tool.pen' ? '画笔' : `[${key}]`),
      tFormat: (key, vars) => {
        if (key === 'hello.{name}') return `你好，${vars?.name ?? ''}`;
        return key;
      },
    };
    render(
      <UiTranslatorProvider value={inject}>
        <Probe />
      </UiTranslatorProvider>,
    );
    expect(screen.getByTestId('t-out').textContent).toBe('画笔');
    expect(screen.getByTestId('tf-out').textContent).toBe('你好，Alice');
  });
});
