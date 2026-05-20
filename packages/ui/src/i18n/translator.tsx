/**
 * Minimal i18n contract for `@slidestage/ui`.
 *
 * UI components only need translations — they intentionally don't depend on
 * locale management, persistence, or the active locale list. Those concerns
 * live in the surrounding preset (e.g. `@slidestage/lite-preset` mounts its
 * full `<I18nProvider>` which in turn wraps the tree with
 * `<UiTranslatorProvider value={{ t, tFormat }}>`).
 *
 * If no provider is mounted, UI components fall back to an identity
 * translator that returns the raw key (with `{name}` substitution still
 * working). This keeps Storybook / isolated tests / boot-time renders
 * legible without forcing every consumer to mount a provider.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface UiTranslator {
  t: (key: string) => string;
  tFormat: (key: string, vars?: Readonly<Record<string, string | number>>) => string;
}

function applyVars(
  template: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  if (!vars) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

const IDENTITY_TRANSLATOR: UiTranslator = {
  t: (key) => key,
  tFormat: (key, vars) => applyVars(key, vars),
};

const UiTranslatorContext = createContext<UiTranslator>(IDENTITY_TRANSLATOR);

interface UiTranslatorProviderProps {
  value: UiTranslator;
  children: ReactNode;
}

export function UiTranslatorProvider({ value, children }: UiTranslatorProviderProps) {
  return <UiTranslatorContext.Provider value={value}>{children}</UiTranslatorContext.Provider>;
}

export function useUiTranslator(): UiTranslator {
  return useContext(UiTranslatorContext);
}
