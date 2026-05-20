/**
 * Optional belt-and-braces keyboard layer for the Tauri build.
 *
 * The renderer's `window.addEventListener('keydown', …)` already covers
 * the common case (focus on the outer container), but when the slide
 * iframe steals focus we want presentation navigation to *still* work.
 * GlobalShortcut hooks the OS event tap and dispatches to our callback
 * regardless of focus.
 *
 * Trade-off: shortcuts are global, so we deliberately scope the active
 * window to be the only consumer by only registering while a deck is
 * open AND the user has explicitly entered the "audience-fullscreen"
 * presentation mode. We unregister on cleanup so other apps reclaim
 * their bindings.
 *
 * All `@tauri-apps/plugin-global-shortcut` imports are dynamic so the
 * Web bundle never pulls them in.
 */

export type PresentationKeyAction =
  | 'next-slide'
  | 'prev-slide'
  | 'first-slide'
  | 'last-slide'
  | 'toggle-blackout'
  | 'exit-fullscreen';

export interface GlobalShortcutHandle {
  unregister(): Promise<void>;
}

interface ShortcutSpec {
  keys: string[];
  action: PresentationKeyAction;
}

const SHORTCUTS: ShortcutSpec[] = [
  { keys: ['Right', 'PageDown', 'Space'], action: 'next-slide' },
  { keys: ['Left', 'PageUp'], action: 'prev-slide' },
  { keys: ['Home'], action: 'first-slide' },
  { keys: ['End'], action: 'last-slide' },
  { keys: ['B'], action: 'toggle-blackout' },
  { keys: ['Escape'], action: 'exit-fullscreen' },
];

/**
 * Register the presentation-navigation keys with the OS. The returned
 * handle's `unregister()` MUST be called on cleanup; we never leak
 * global shortcuts to other apps.
 */
export async function registerPresentationShortcuts(
  onAction: (action: PresentationKeyAction) => void,
): Promise<GlobalShortcutHandle> {
  const { register, unregisterAll } = await import(
    '@tauri-apps/plugin-global-shortcut'
  );
  const registered: string[] = [];
  for (const spec of SHORTCUTS) {
    for (const key of spec.keys) {
      try {
        await register(key, (event: { state?: string }) => {
          if (event.state !== 'Pressed') return;
          onAction(spec.action);
        });
        registered.push(key);
      } catch (err) {
        // A key already claimed by another app (e.g. Escape under some
        // window managers) is non-fatal — keep going with the rest.
        // eslint-disable-next-line no-console
        console.warn(`global shortcut register failed: ${key}`, err);
      }
    }
  }
  return {
    async unregister(): Promise<void> {
      try {
        await unregisterAll();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('global shortcut unregisterAll failed', err);
      }
    },
  };
}
