/**
 * Parity & smoke tests for the i18n dictionaries.
 *
 * Lite is a no-backend SPA — there is no "missing translation" warning at
 * runtime, the message just falls back to English. To prevent silent
 * regressions when somebody adds a key only in en/, this suite enforces:
 *
 *   1. every locale has *exactly* the same key set (no extras, no gaps);
 *   2. every value is a non-empty trimmed string;
 *   3. placeholder shape (e.g. `{name}`) matches across locales for every
 *      key, so consumers can rely on the same vars regardless of locale;
 *   4. `format()` substitutes known placeholders and preserves unknown
 *      ones so authors notice missing variables during development;
 *   5. `translate()` falls back gracefully when a key is missing in the
 *      requested locale.
 */
import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from './locales';
import { format, messages, translate } from './messages';

const englishKeys = new Set(Object.keys(messages.en));
const otherLocales: Locale[] = LOCALES.filter((l) => l !== 'en');

function extractPlaceholders(value: string): string[] {
  return Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
}

describe('i18n message dictionaries', () => {
  it('every supported locale has a dictionary', () => {
    for (const locale of LOCALES) {
      expect(messages[locale], `missing dictionary for ${locale}`).toBeDefined();
    }
  });

  it.each(otherLocales)('%s has exactly the same keys as en', (locale) => {
    const keys = new Set(Object.keys(messages[locale]));
    const missing = [...englishKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !englishKeys.has(k));
    expect(missing, `${locale} is missing keys`).toEqual([]);
    expect(extra, `${locale} declares unknown keys`).toEqual([]);
  });

  it.each(LOCALES)('%s has only non-empty trimmed values', (locale) => {
    for (const [key, value] of Object.entries(messages[locale])) {
      expect(value, `${locale}:${key} is empty`).not.toBe('');
      expect(value.trim(), `${locale}:${key} has surrounding whitespace`).toBe(
        value,
      );
    }
  });

  it.each(otherLocales)(
    '%s reuses the same {placeholders} as en for every key',
    (locale) => {
      const mismatches: Array<{ key: string; en: string[]; other: string[] }> = [];
      for (const key of englishKeys) {
        const enPlaceholders = extractPlaceholders(messages.en[key]);
        const otherPlaceholders = extractPlaceholders(messages[locale][key]);
        if (JSON.stringify(enPlaceholders) !== JSON.stringify(otherPlaceholders)) {
          mismatches.push({ key, en: enPlaceholders, other: otherPlaceholders });
        }
      }
      expect(mismatches, `${locale} drifted placeholder names`).toEqual([]);
    },
  );
});

describe('format()', () => {
  it('substitutes known placeholders', () => {
    expect(
      format('hello {name}, you are #{n}', { name: '阿三', n: 7 }),
    ).toBe('hello 阿三, you are #7');
  });

  it('keeps unknown placeholders so dev notices', () => {
    expect(format('{a} / {b}', { a: 'left' })).toBe('left / {b}');
  });

  it('returns the template untouched when no vars provided', () => {
    expect(format('just text')).toBe('just text');
  });
});

describe('translate()', () => {
  it('returns the localized string when present', () => {
    expect(translate('en', 'app.brand.name')).toBe('SlideStageLite');
    expect(translate('zh-CN', 'app.header.meta')).toBe('本地运行 · 无服务端');
  });

  it('falls back to en when the key is missing in the requested locale', () => {
    const phantomLocale = 'zh-CN' as const;
    const dict = messages[phantomLocale] as Record<string, string>;
    const original = dict['app.brand.name'];
    delete dict['app.brand.name'];
    try {
      expect(translate(phantomLocale, 'app.brand.name')).toBe('SlideStageLite');
    } finally {
      dict['app.brand.name'] = original;
    }
  });

  it('falls back to the key itself when neither locale has it', () => {
    expect(translate('en', 'definitely.missing.key')).toBe(
      'definitely.missing.key',
    );
  });
});
