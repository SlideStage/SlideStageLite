/**
 * Tests for the Phase 4 host factory in `@slidestage/core`. The factory
 * is intentionally tiny but it is the contract Pro will lean on, so the
 * cases here pin down the policies we explicitly chose:
 *   - chained `use()` returns the same stage and runs `install` synchronously
 *   - `mount()` only triggers the most-recently-registered plugin's mount hook
 *   - the disposer is idempotent
 *   - hostile inputs throw clearly with the plugin name in the message
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createSlideStage,
  type SlideStagePlugin,
} from '@slidestage/core/createSlideStage';

function makePlugin(
  overrides: Partial<SlideStagePlugin> & { name: string },
): SlideStagePlugin {
  return overrides;
}

describe('createSlideStage', () => {
  it('returns a chainable stage from .use(plugin)', () => {
    const stage = createSlideStage();
    const plugin = makePlugin({ name: 'a' });
    expect(stage.use(plugin)).toBe(stage);
  });

  it('runs install hooks synchronously when plugins register', () => {
    const stage = createSlideStage();
    const installA = vi.fn();
    const installB = vi.fn();
    stage.use(makePlugin({ name: 'a', install: installA }));
    expect(installA).toHaveBeenCalledTimes(1);
    expect(installA).toHaveBeenCalledWith(stage);
    stage.use(makePlugin({ name: 'b', install: installB }));
    expect(installB).toHaveBeenCalledTimes(1);
  });

  it('forwards .mount() to the host element when given a selector string', () => {
    const target = document.createElement('div');
    target.id = 'mount-target';
    document.body.appendChild(target);
    try {
      const mountFn = vi.fn();
      createSlideStage()
        .use(makePlugin({ name: 'host', mount: mountFn }))
        .mount('#mount-target');
      expect(mountFn).toHaveBeenCalledWith(target);
    } finally {
      target.remove();
    }
  });

  it('forwards .mount() with a raw HTMLElement target unchanged', () => {
    const el = document.createElement('div');
    const mountFn = vi.fn();
    createSlideStage()
      .use(makePlugin({ name: 'host', mount: mountFn }))
      .mount(el);
    expect(mountFn).toHaveBeenCalledWith(el);
  });

  it('only calls the LAST plugin that defines mount() (Q1 last-wins policy)', () => {
    const el = document.createElement('div');
    const earlyMount = vi.fn();
    const lateMount = vi.fn();
    const otherInstall = vi.fn();
    createSlideStage()
      .use(makePlugin({ name: 'early-mount', mount: earlyMount }))
      .use(makePlugin({ name: 'middle-install-only', install: otherInstall }))
      .use(makePlugin({ name: 'late-mount', mount: lateMount }))
      .mount(el);
    expect(lateMount).toHaveBeenCalledTimes(1);
    expect(earlyMount).not.toHaveBeenCalled();
    expect(otherInstall).toHaveBeenCalledTimes(1);
  });

  it('returns a disposer that calls back into the plugin disposer', () => {
    const el = document.createElement('div');
    const reportedDisposer = vi.fn();
    const dispose = createSlideStage()
      .use(makePlugin({ name: 'host', mount: () => reportedDisposer }))
      .mount(el);
    expect(reportedDisposer).not.toHaveBeenCalled();
    dispose();
    expect(reportedDisposer).toHaveBeenCalledTimes(1);
  });

  it('disposer is idempotent — calling it twice runs the plugin disposer once', () => {
    const el = document.createElement('div');
    const reportedDisposer = vi.fn();
    const dispose = createSlideStage()
      .use(makePlugin({ name: 'host', mount: () => reportedDisposer }))
      .mount(el);
    dispose();
    dispose();
    dispose();
    expect(reportedDisposer).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op disposer when the plugin reports no cleanup function', () => {
    const el = document.createElement('div');
    const dispose = createSlideStage()
      .use(makePlugin({ name: 'host', mount: () => undefined }))
      .mount(el);
    expect(() => dispose()).not.toThrow();
  });

  it('throws when stage.mount() is called with no mount-capable plugin registered', () => {
    expect(() =>
      createSlideStage()
        .use(makePlugin({ name: 'install-only', install: () => {} }))
        .mount(document.createElement('div')),
    ).toThrow(/no registered plugin defined a mount\(\) hook/);
  });

  it('throws when the selector resolves to nothing', () => {
    expect(() =>
      createSlideStage()
        .use(makePlugin({ name: 'host', mount: () => undefined }))
        .mount('#does-not-exist'),
    ).toThrow(/did not match any element/);
  });

  it('throws when use() receives a plugin missing a name', () => {
    expect(() =>
      createSlideStage().use({ name: '' } as SlideStagePlugin),
    ).toThrow(/non-empty plugin\.name/);
  });

  it('wraps install() errors with the offending plugin name in the message', () => {
    const failure = new Error('boom');
    expect(() =>
      createSlideStage().use(
        makePlugin({
          name: 'badPlugin',
          install: () => {
            throw failure;
          },
        }),
      ),
    ).toThrow(/plugin "badPlugin" install hook failed: boom/);
  });
});
