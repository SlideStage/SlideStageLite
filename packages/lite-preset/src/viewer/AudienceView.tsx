import { useEffect, useMemo, useState } from 'react';
import {
  AudienceView as UiAudienceView,
  type AudienceTrustAdapter,
  type AudienceWindowAdapter,
} from '@slidestage/ui/viewer/AudienceView';
import { isTauri } from '../desktop/env';
import { loadTrustGrant } from '../persistence/trustStore';

function readDeckFingerprintFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('deck');
  return value && value.length > 0 ? value : null;
}

/**
 * Lite-specific AudienceView wrapper. Parses the deck fingerprint
 * from the URL (`?audience=1&deck=<fp>`) and wires the UI's
 * trust/window adapters to Lite-specific implementations (localStorage
 * trust store + dynamically imported `@tauri-apps/api/window`).
 */
export function AudienceView() {
  const deckFingerprint = useMemo(() => readDeckFingerprintFromUrl(), []);
  const tauriMode = isTauri();
  const [audienceWindowAdapter, setAudienceWindowAdapter] =
    useState<AudienceWindowAdapter | null>(null);

  const trustAdapter = useMemo<AudienceTrustAdapter>(
    () => ({
      loadGrant: (fingerprint, capabilities) => loadTrustGrant(fingerprint, capabilities),
    }),
    [],
  );

  useEffect(() => {
    if (!tauriMode) return undefined;
    let cancelled = false;
    let getCurrentWindow: typeof import('@tauri-apps/api/window')['getCurrentWindow'] | null =
      null;
    (async () => {
      try {
        const mod = await import('@tauri-apps/api/window');
        getCurrentWindow = mod.getCurrentWindow;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('audience: failed to load @tauri-apps/api/window', err);
        return;
      }
      if (cancelled || !getCurrentWindow) return;
      const adapter: AudienceWindowAdapter = {
        isFullscreen: () => getCurrentWindow!().isFullscreen(),
        setFullscreen: (next) => getCurrentWindow!().setFullscreen(next),
        close: () => getCurrentWindow!().close(),
        onResize: (cb) => {
          let unlisten: (() => void) | null = null;
          let disposed = false;
          getCurrentWindow!()
            .onResized(() => cb())
            .then((handle) => {
              if (disposed) {
                handle();
              } else {
                unlisten = handle;
              }
            })
            .catch((err: unknown) => {
              // eslint-disable-next-line no-console
              console.warn('audience: onResized failed to bind', err);
            });
          return () => {
            disposed = true;
            try {
              unlisten?.();
            } catch {
              // ignore
            }
          };
        },
      };
      setAudienceWindowAdapter(adapter);
    })();
    return () => {
      cancelled = true;
    };
  }, [tauriMode]);

  return (
    <UiAudienceView
      deckFingerprint={deckFingerprint}
      trustAdapter={trustAdapter}
      audienceWindowAdapter={audienceWindowAdapter ?? undefined}
    />
  );
}
