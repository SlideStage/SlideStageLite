import { afterEach, describe, expect, it } from 'vitest';
import { isTauri } from '@slidestage/lite-preset/desktop/env';

describe('isTauri', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('returns false in plain jsdom (no Tauri internals global)', () => {
    expect(isTauri()).toBe(false);
  });

  it('returns true once the Tauri host sets the internals global', () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });
});
