/**
 * Smoke tests for `litePreset()` — the SlideStagePlugin Lite hands to
 * `createSlideStage()`. These tests intentionally don't try to render
 * the entire `<LiteApp />` (that surface is huge and depends on
 * service-worker / Tauri APIs that jsdom doesn't ship); we just pin
 * the contract that:
 *   - the factory returns a plugin shaped the way `createSlideStage`
 *     expects ({ name: 'lite', mount(el) }),
 *   - `mount(el)` runs Lite's host bootstrap (legacy migration) and
 *     populates the provided element with a React root,
 *   - the returned disposer unmounts the React root,
 *   - `strictMode: false` skips the StrictMode wrapper.
 *
 * React 19's `createRoot.render()` schedules concurrent work, so every
 * place that mutates the React tree is wrapped in `act()` to flush
 * updates before assertions run.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createSlideStage } from '@slidestage/core/createSlideStage';
import { litePreset } from '@slidestage/lite-preset/litePreset';
import { LOCALE_STORAGE_KEY } from '@slidestage/lite-preset/i18n/detect';

describe('litePreset()', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    window.localStorage.clear();
  });

  async function mountLite(
    options?: Parameters<typeof litePreset>[0],
  ): Promise<() => void> {
    let dispose: () => void = () => {};
    await act(async () => {
      dispose = createSlideStage().use(litePreset(options)).mount(root);
    });
    return async () => {
      await act(async () => {
        dispose();
      });
    };
  }

  it('returns a plugin named "lite" with a mount function', () => {
    const plugin = litePreset();
    expect(plugin.name).toBe('lite');
    expect(typeof plugin.mount).toBe('function');
  });

  it('mounts the React tree into the provided element', async () => {
    const dispose = await mountLite();
    try {
      // The landing page renders the brand mark, which is the cheapest
      // observable proof that React mounted and the Lite I18n provider
      // resolved its locale messages.
      expect(root.innerHTML).toContain('app-shell');
      expect(root.innerHTML).toContain('app-brand-mark');
    } finally {
      await dispose();
    }
  });

  it('drains legacy localStorage entries during mount (runLegacyMigration runs)', async () => {
    // Stash a legacy hcslides-lite key — runLegacyMigration's contract is to
    // copy it onto the SlideStage namespace and remove the legacy entry.
    window.localStorage.setItem('hcslides-lite:locale', 'zh-CN');
    const dispose = await mountLite();
    try {
      expect(window.localStorage.getItem('hcslides-lite:locale')).toBeNull();
      // Migrated value should be readable through the new namespace.
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    } finally {
      await dispose();
    }
  });

  it('disposer empties the host element', async () => {
    const dispose = await mountLite();
    expect(root.children.length).toBeGreaterThan(0);
    await dispose();
    // React 19's createRoot.unmount synchronously clears children when
    // the root has no pending work; the wrapping act() flushes any
    // residual work before the assertion below.
    expect(root.innerHTML).toBe('');
  });

  it('strictMode: false skips the StrictMode wrapper but still mounts', async () => {
    const dispose = await mountLite({ strictMode: false });
    try {
      // Hard to assert the absence of StrictMode from the rendered DOM
      // (StrictMode is a React-fiber-internal wrapper, not a DOM
      // element), so we just verify that the simpler tree still mounts
      // cleanly and produces the same observable surface.
      expect(root.innerHTML).toContain('app-shell');
    } finally {
      await dispose();
    }
  });

  it('plays nicely with createSlideStage().mount() return-value contract', async () => {
    // Smoke that the disposer composition through createSlideStage works:
    // call dispose multiple times, confirm it's idempotent and React
    // doesn't throw "double unmount" warnings.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = await mountLite();
    await dispose();
    await dispose();
    await dispose();
    // We allow legitimate console.error calls (e.g. AsyncMode warnings)
    // but flag the specific "Cannot unmount" / "double unmount" pattern
    // so a regression in createSlideStage's dispose idempotency surfaces.
    const offending = errSpy.mock.calls
      .map((args) => args.map(String).join(' '))
      .filter((line) => /unmount/i.test(line));
    expect(offending).toEqual([]);
    errSpy.mockRestore();
  });
});
