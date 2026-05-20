/**
 * Tiny React context for SlideStageLite localisation.
 *
 * We intentionally avoid pulling in `react-intl` / `i18next` — Lite is the
 * no-backend twin of Pro and ships a single ~7 KB locale bundle. The
 * provider exposes `useI18n()` which returns `{ locale, setLocale, t,
 * tFormat, locales, label }`. Components read translations through `t()`.
 *
 * Side effects:
 *   - Persists the active locale to localStorage on every change.
 *   - Mirrors the locale onto `<html lang="...">` so screen readers and
 *     CJK font fallbacks behave correctly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UiTranslatorProvider } from '@slidestage/ui/i18n/translator';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  type Locale,
} from './locales';
import { detectLocale, persistLocale } from './detect';
import { format, translate } from './messages';

export interface I18nContextValue {
  locale: Locale;
  locales: readonly Locale[];
  label: (locale: Locale) => string;
  shortLabel: (locale: Locale) => string;
  setLocale: (next: Locale) => void;
  /** Translate a key without interpolation. */
  t: (key: string) => string;
  /** Translate a key with `{name}` placeholder substitution. */
  tFormat: (key: string, vars?: Readonly<Record<string, string | number>>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  children: ReactNode;
  /**
   * Force a starting locale, bypassing detection. Used by tests and by the
   * audience window which inherits the presenter's choice via URL/storage.
   */
  initialLocale?: Locale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? detectLocale(),
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState((current) => {
      if (current === next) return current;
      persistLocale(next);
      return next;
    });
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      locales: LOCALES,
      label: (l) => LOCALE_LABELS[l],
      shortLabel: (l) => LOCALE_SHORT_LABELS[l],
      setLocale,
      t: (key) => translate(locale, key),
      tFormat: (key, vars) => format(translate(locale, key), vars),
    }),
    [locale, setLocale],
  );

  const uiTranslator = useMemo(
    () => ({ t: value.t, tFormat: value.tFormat }),
    [value.t, value.tFormat],
  );

  return (
    <I18nContext.Provider value={value}>
      <UiTranslatorProvider value={uiTranslator}>{children}</UiTranslatorProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Provider missing → silently fall back to the default locale so the
    // SPA still renders something legible during boot.
    return {
      locale: DEFAULT_LOCALE,
      locales: LOCALES,
      label: (l) => LOCALE_LABELS[l],
      shortLabel: (l) => LOCALE_SHORT_LABELS[l],
      setLocale: () => undefined,
      t: (key) => translate(DEFAULT_LOCALE, key),
      tFormat: (key, vars) => format(translate(DEFAULT_LOCALE, key), vars),
    };
  }
  return ctx;
}

/** Convenience for components that only care about translations. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
