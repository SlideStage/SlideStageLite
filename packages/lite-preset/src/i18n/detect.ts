/**
 * Locale resolution for the Lite SPA.
 *
 * Priority (highest wins):
 *   1. `?lang=zh-CN` on the URL (also accepts `zh`, normalised to `zh-CN`).
 *   2. localStorage entry under `LOCALE_STORAGE_KEY` (the user picked from
 *      the header switcher previously).
 *   3. `navigator.language` / `navigator.languages` if it points at a
 *      supported locale.
 *   4. `DEFAULT_LOCALE` (English).
 *
 * The URL parameter overrides everything so test harnesses and shared
 * links can pin a deterministic locale without poking storage. Playwright
 * E2E tests rely on this — they run in fresh Chromium contexts with
 * en-US locale, so the default stays English and existing English
 * assertions keep passing.
 */
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './locales';

export const LOCALE_STORAGE_KEY = 'slidestage-lite:locale';

const ZH_PATTERN = /^zh(?:[-_]|$)/i;

function fromString(value: string | null | undefined): Locale | null {
  if (!value) return null;
  if (isLocale(value)) return value;
  if (ZH_PATTERN.test(value)) return 'zh-CN';
  return null;
}

function readUrlLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    return fromString(new URLSearchParams(window.location.search).get('lang'));
  } catch {
    return null;
  }
}

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    return fromString(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readNavigatorLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  const candidates: string[] = [];
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  if (navigator.language) candidates.push(navigator.language);
  for (const value of candidates) {
    const matched = fromString(value);
    if (matched) return matched;
  }
  return null;
}

export interface DetectOptions {
  /** Inject a pre-resolved value to bypass DOM/global reads (tests). */
  override?: Locale | null;
}

export function detectLocale(options: DetectOptions = {}): Locale {
  return (
    options.override ??
    readUrlLocale() ??
    readStoredLocale() ??
    readNavigatorLocale() ??
    DEFAULT_LOCALE
  );
}

export function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore quota / disabled storage; the next page load will re-detect.
  }
}

/** Exposed for unit tests. */
export const __test = { fromString, readUrlLocale, readStoredLocale, readNavigatorLocale, LOCALES };
