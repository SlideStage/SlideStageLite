import { useEffect, useRef } from 'react';
import { isTauri } from '../desktop/env';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Keep an "unexported text edits" exit reminder armed while the deck
 * viewer is mounted:
 *
 * - Web: a native `beforeunload` prompt while `unsaved` is true.
 * - Desktop (Tauri): intercept window close and the macOS quit menu with
 *   a native ask dialog (see `desktop/closeGuard.ts`), and mirror the
 *   flag to Rust so a quit with nothing unsaved stays instant.
 *
 * The guard lives exactly as long as the mounting component (the lite
 * DeckViewer): once the deck is closed the edits-in-file question is
 * moot — patches stay in localStorage and re-apply on the next open.
 */
export function useUnsavedExitGuard(unsaved: boolean): void {
  const { t } = useI18n();
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const tRef = useRef(t);
  tRef.current = t;

  // Web: browsers ignore custom text; preventDefault is the contract.
  useEffect(() => {
    if (isTauri() || typeof window === 'undefined') return undefined;
    if (!unsaved) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chromium still requires returnValue for the prompt to show.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);

  // Desktop: mirror the flag to Rust (quit-menu fast path).
  useEffect(() => {
    if (!isTauri()) return undefined;
    let cancelled = false;
    void import('../desktop/closeGuard')
      .then(({ setDesktopUnsavedFlag }) =>
        cancelled ? undefined : setDesktopUnsavedFlag(unsaved),
      )
      .catch(() => {
        // Command unavailable (older shell) — the JS close guard still works.
      });
    return () => {
      cancelled = true;
    };
  }, [unsaved]);

  // Desktop: close/quit interception, attached once per deck-open
  // lifetime. Cleanup lowers the Rust flag so quitting after the deck
  // closes never round-trips through a dead listener.
  useEffect(() => {
    if (!isTauri()) return undefined;
    let cancelled = false;
    let guard: { detach(): void } | null = null;
    void import('../desktop/closeGuard')
      .then(async (mod) => {
        const attached = await mod.attachUnsavedExitGuard({
          isUnsaved: () => unsavedRef.current,
          getLabels: () => ({
            title: tRef.current('viewer.editing.unsavedExitTitle'),
            body: tRef.current('viewer.editing.unsavedExitBody'),
            confirmLabel: tRef.current('viewer.editing.unsavedExitConfirm'),
            cancelLabel: tRef.current('viewer.editing.unsavedExitCancel'),
          }),
        });
        if (cancelled) {
          attached.detach();
          return;
        }
        guard = attached;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('unsaved-exit guard setup failed', err);
      });
    return () => {
      cancelled = true;
      guard?.detach();
      guard = null;
      void import('../desktop/closeGuard')
        .then(({ setDesktopUnsavedFlag }) => setDesktopUnsavedFlag(false))
        .catch(() => {
          // ignore
        });
    };
  }, []);
}
