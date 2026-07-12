/**
 * Modifier-key contract for `usePresenterShortcuts`.
 *
 * The presenter tool shortcuts are bare-key (`b`, `w`, `1..5`, `[`, `]`)
 * or Shift+letter (Shift+S = spotlight, ...) bindings. They must never
 * fire while a system-level modifier is held, otherwise Cmd+B
 * (bookmarks), Ctrl+W (close tab), Cmd+Shift+S (save as), or Cmd+1..5
 * (tab switch) would silently trigger presenter tools. Cmd/Ctrl+Z stays
 * the one modifier-bearing binding (undo).
 */
import { renderHook, cleanup } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  usePresenter,
  usePresenterShortcuts,
  type PresenterApi,
} from '@slidestage/ui/presenter/usePresenter';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function setup(): { current: () => PresenterApi } {
  const rendered = renderHook(() => {
    const api = usePresenter();
    usePresenterShortcuts(api, 0);
    return api;
  });
  return { current: () => rendered.result.current };
}

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

describe('usePresenterShortcuts modifier guards', () => {
  it('Shift+S selects the spotlight tool', () => {
    const api = setup();
    press('S', { shiftKey: true });
    expect(api.current().state.tool).toBe('spotlight');
  });

  it('Cmd/Ctrl+Shift+S does not select the spotlight tool (save-as combo)', () => {
    const api = setup();
    press('S', { shiftKey: true, metaKey: true });
    press('S', { shiftKey: true, ctrlKey: true });
    expect(api.current().state.tool).toBe('mouse');
  });

  it('plain b toggles blackout, but Cmd/Ctrl+B is left to the browser', () => {
    const api = setup();
    press('b', { metaKey: true });
    expect(api.current().state.tool).toBe('mouse');
    press('b', { ctrlKey: true });
    expect(api.current().state.tool).toBe('mouse');
    press('b');
    expect(api.current().state.tool).toBe('blackout');
  });

  it('Cmd/Ctrl+W does not toggle whiteout (close-window combo)', () => {
    const api = setup();
    press('w', { metaKey: true });
    expect(api.current().state.tool).toBe('mouse');
    press('w');
    expect(api.current().state.tool).toBe('whiteout');
  });

  it('Cmd/Ctrl+1..5 does not change pen colors (tab-switch combo)', () => {
    const api = setup();
    press('P', { shiftKey: true });
    expect(api.current().state.tool).toBe('pen');
    const initialColor = api.current().state.penColor;
    press('3', { metaKey: true });
    expect(api.current().state.penColor).toBe(initialColor);
    press('3');
    expect(api.current().state.penColor).not.toBe(initialColor);
  });

  it('Cmd/Ctrl+[ does not nudge the spotlight radius (history-back combo)', () => {
    const api = setup();
    press('S', { shiftKey: true });
    expect(api.current().state.tool).toBe('spotlight');
    const initialRadius = api.current().state.spotlightRadius;
    press('[', { metaKey: true });
    expect(api.current().state.spotlightRadius).toBe(initialRadius);
    press('[');
    expect(api.current().state.spotlightRadius).toBeLessThan(initialRadius);
  });

  it('Cmd/Ctrl+Z still undoes', () => {
    const api = setup();
    act(() => {
      api.current().appendStroke(0, {
        tool: 'pen',
        color: '#FF3B30',
        width: 3,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      });
    });
    expect(api.current().state.strokesByIdx[0]).toHaveLength(1);
    press('z', { metaKey: true });
    expect(api.current().state.strokesByIdx[0]).toHaveLength(0);
  });
});
