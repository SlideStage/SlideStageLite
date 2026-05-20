/**
 * Tiny plugin host for the SlideStage runtime. Designed to stay
 * React-free so `@slidestage/core` can be consumed by Lite (React),
 * future Pro builds (potentially mixed React + non-React mounts), and
 * automated tests.
 *
 * Lifecycle:
 *   - `stage.use(plugin)` runs `plugin.install?(stage)` synchronously
 *     and stashes the plugin. Plugins SHOULD use `install` for
 *     side-effect-free registration only (capabilities, services,
 *     event listeners on `globalThis`, etc.).
 *   - `stage.mount(target)` resolves `target` to an `HTMLElement` and
 *     invokes `mount(el)` on the most recently registered plugin that
 *     defines one. Returns a disposer that, when called, runs the
 *     plugin's reported disposer (if any) and is idempotent.
 *
 * Why "last plugin's mount wins" instead of "every plugin mounts":
 *   - The first user case (Lite) has exactly one plugin, so the policy
 *     is invisible.
 *   - Pro will add capability plugins via `install` (e.g. realtime
 *     sync, cloud import) and ship its own root plugin via the same
 *     pattern. The "last `mount` wins" rule means Pro can layer its
 *     enhancements over `litePreset()` and override the root mount in
 *     a single line, mirroring how Vue/Svelte plugin chains work.
 *   - If/when we need the "every plugin mounts" semantics we'll add a
 *     second escape hatch (`stage.mountAll`) instead of changing the
 *     default contract.
 */

export type SlideStageDisposer = () => void;

export interface SlideStage {
  /**
   * Register a plugin and synchronously run its `install` hook. Returns
   * the same stage instance so calls can be chained:
   *
   * ```ts
   * createSlideStage().use(litePreset()).mount('#root');
   * ```
   */
  use(plugin: SlideStagePlugin): SlideStage;
  /**
   * Resolve `target` to an `HTMLElement` and run the most-recently
   * registered plugin's `mount(el)` hook. Returns a disposer that
   * releases the mounted plugin's resources. Throws synchronously if
   * `target` resolves to nothing (`document.querySelector` returned
   * `null`) or no registered plugin defined `mount`.
   *
   * Idempotency: the returned disposer may be invoked multiple times;
   * subsequent calls are a no-op.
   */
  mount(target: string | HTMLElement): SlideStageDisposer;
}

export interface SlideStagePlugin {
  /** Diagnostic name used in error messages. Required so misconfigured chains fail loudly. */
  name: string;
  /**
   * Synchronous setup hook. Receives the stage so the plugin can call
   * back into `use()` for transitive plugins, register capabilities on
   * a future capability registry, etc. Optional.
   */
  install?(stage: SlideStage): void;
  /**
   * Hook that owns the on-screen mount. Optional so capability-only
   * plugins (telemetry, sync) can skip it. The "last plugin wins"
   * dispatcher in {@link SlideStage.mount} only invokes the most
   * recently registered plugin's `mount`.
   */
  mount?(el: HTMLElement): SlideStageDisposer | void;
}

function resolveMountTarget(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') {
    return target;
  }
  if (typeof document === 'undefined') {
    throw new Error(
      `createSlideStage: cannot mount to selector ${target} outside of a browser environment.`,
    );
  }
  const node = document.querySelector(target);
  if (!node) {
    throw new Error(`createSlideStage: mount target ${target} did not match any element.`);
  }
  return node as HTMLElement;
}

export function createSlideStage(): SlideStage {
  const plugins: SlideStagePlugin[] = [];

  const stage: SlideStage = {
    use(plugin) {
      if (!plugin || typeof plugin.name !== 'string' || plugin.name.length === 0) {
        throw new Error(
          'createSlideStage: plugin.use(...) requires a non-empty plugin.name.',
        );
      }
      plugins.push(plugin);
      try {
        plugin.install?.(stage);
      } catch (err) {
        const wrapped = new Error(
          `createSlideStage: plugin "${plugin.name}" install hook failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        if (err instanceof Error && err.stack) {
          (wrapped as { stack?: string }).stack = err.stack;
        }
        throw wrapped;
      }
      return stage;
    },
    mount(target) {
      const el = resolveMountTarget(target);
      // Iterate in reverse so the most recently registered plugin wins.
      const root = [...plugins].reverse().find((p) => typeof p.mount === 'function');
      if (!root) {
        throw new Error(
          'createSlideStage: stage.mount(...) called but no registered plugin defined a mount() hook.',
        );
      }
      const reported = root.mount?.(el);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        if (typeof reported === 'function') {
          reported();
        }
      };
    },
  };

  return stage;
}
