/**
 * Supported UI locales for SlideStageLite.
 *
 * Keep this list small on purpose — every entry must have a complete
 * translation in `messages.ts` (enforced by `messages.test.ts`). Add a new
 * locale by extending `LOCALES`, providing the dictionary, and listing the
 * native label in `LOCALE_LABELS`.
 */
export const LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Native-script label rendered inside the header language switcher and
 * accessible name. We keep `en` as "English" (not "EN") and Chinese in
 * Simplified `中文` to match Pro's typography conventions.
 */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  'zh-CN': '中文',
};

/** Short label used inside compact segmented controls. */
export const LOCALE_SHORT_LABELS: Readonly<Record<Locale, string>> = {
  en: 'EN',
  'zh-CN': '中',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
