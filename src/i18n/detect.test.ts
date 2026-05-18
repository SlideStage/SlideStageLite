/**
 * Unit tests for the locale resolver. These exercise the resolution
 * priority chain so that the URL override (used by tests and shared
 * links) always wins, localStorage is honoured next, and finally
 * navigator.language hints kick in. Everything else falls through to
 * English so the SPA renders predictably out of the box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, LOCALE_STORAGE_KEY, persistLocale } from './detect';

function setSearch(query: string): void {
  window.history.replaceState(null, '', query.length > 0 ? `/?${query}` : '/');
}

describe('detectLocale()', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSearch('');
  });

  afterEach(() => {
    setSearch('');
  });

  it('returns the explicit override when provided (bypassing DOM reads)', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    setSearch('lang=zh-CN');
    expect(detectLocale({ override: 'en' })).toBe('en');
  });

  it('prefers `?lang=` over localStorage', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    setSearch('lang=zh-CN');
    expect(detectLocale()).toBe('zh-CN');
  });

  it('normalises `?lang=zh` to `zh-CN`', () => {
    setSearch('lang=zh');
    expect(detectLocale()).toBe('zh-CN');
  });

  it('falls back to localStorage when the URL says nothing', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    expect(detectLocale()).toBe('zh-CN');
  });

  it('falls back to navigator.language', () => {
    const spy = vi
      .spyOn(navigator, 'languages', 'get')
      .mockReturnValue(['fr-FR', 'zh-TW']);
    try {
      expect(detectLocale()).toBe('zh-CN');
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults to en when nothing matches', () => {
    const spy = vi
      .spyOn(navigator, 'languages', 'get')
      .mockReturnValue(['fr-FR']);
    try {
      expect(detectLocale()).toBe('en');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('persistLocale()', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('writes the locale into localStorage under the documented key', () => {
    persistLocale('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });
});
