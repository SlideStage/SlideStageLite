/**
 * Lite's `SlideStagePlugin` factory. The exported `litePreset()`
 * returns the plugin that, when handed to `createSlideStage().use(...)`,
 * owns the React root and runs Lite's host-level bootstrap:
 *
 *   - Drain any legacy `hcslides-lite:*` localStorage entries left over
 *     from before the SlideStage brand rename. Done synchronously
 *     before React mounts so the first render sees migrated values.
 *   - Kick the service worker registration so the controller is usually
 *     `activated` by the time the user opens their first deck. No-op in
 *     Tauri / file:// hosts.
 *   - Render `<I18nProvider><LiteApp /></I18nProvider>` into the host
 *     element returned by `stage.mount(target)`.
 *
 * The returned disposer unmounts the React root. Service worker / DOM
 * side effects are intentionally left in place — they're idempotent and
 * the browser owns their lifecycle.
 */
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import type { SlideStagePlugin } from '@slidestage/core/createSlideStage';
import { I18nProvider } from './i18n/I18nProvider';
import { runLegacyMigration } from './persistence/legacyMigration';
import { registerStageServiceWorker } from './browser/stageServiceWorker';
import { LiteApp } from './app/LiteApp';

export interface LitePresetOptions {
  /**
   * When set to `false`, skip the React `<StrictMode>` wrapper. The
   * default `true` matches the historical Lite bootstrap and surfaces
   * double-invocation bugs early. Tests / debug overlays sometimes
   * disable it to avoid the dev-only double-mount noise.
   */
  strictMode?: boolean;
}

export function litePreset(options: LitePresetOptions = {}): SlideStagePlugin {
  const { strictMode = true } = options;

  return {
    name: 'lite',
    mount(el) {
      runLegacyMigration();
      void registerStageServiceWorker();

      const root = ReactDOM.createRoot(el);
      const tree = (
        <I18nProvider>
          <LiteApp />
        </I18nProvider>
      );
      root.render(strictMode ? <StrictMode>{tree}</StrictMode> : tree);

      return () => {
        root.unmount();
      };
    },
  };
}
