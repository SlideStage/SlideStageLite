/**
 * Segmented control for the interface language.
 *
 * Lives in the app header (and the audience window header) and surfaces
 * every locale registered in `LOCALES`. We render it as a native
 * `<button>` group with `aria-pressed` semantics so screen readers
 * announce the active language without needing a hidden `<select>`.
 */
import { Languages } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

interface LanguageSwitcherProps {
  /** Optional className appended to the wrapper for layout overrides. */
  className?: string;
  /** Use short labels ("EN", "中") when horizontal space is tight. */
  compact?: boolean;
  /** Test hook id; defaults to `language-switcher`. */
  testId?: string;
}

export function LanguageSwitcher({
  className,
  compact = false,
  testId = 'language-switcher',
}: LanguageSwitcherProps) {
  const { locale, locales, label, shortLabel, setLocale, t } = useI18n();

  return (
    <div
      className={`language-switcher${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={t('language.aria')}
      data-testid={testId}
    >
      <Languages className="language-switcher-icon" aria-hidden size={14} />
      <span className="visually-hidden">{t('language.menu')}</span>
      {locales.map((value) => {
        const isActive = value === locale;
        return (
          <button
            key={value}
            type="button"
            className={`language-switcher-option${isActive ? ' active' : ''}`}
            aria-pressed={isActive}
            data-locale={value}
            data-testid={`language-switcher-${value}`}
            onClick={() => setLocale(value)}
            title={label(value)}
          >
            {compact ? shortLabel(value) : label(value)}
          </button>
        );
      })}
    </div>
  );
}
