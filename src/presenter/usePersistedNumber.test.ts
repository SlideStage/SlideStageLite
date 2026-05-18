import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePersistedNumber } from './usePersistedNumber';

describe('usePersistedNumber', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns the initial value when no value is stored', () => {
    const { result } = renderHook(() =>
      usePersistedNumber({ key: 'test:size', initial: 320, min: 200, max: 500 }),
    );
    expect(result.current[0]).toBe(320);
  });

  it('hydrates from localStorage and clamps to range', () => {
    window.localStorage.setItem('test:size', '700');
    const { result } = renderHook(() =>
      usePersistedNumber({ key: 'test:size', initial: 320, min: 200, max: 500 }),
    );
    expect(result.current[0]).toBe(500);
  });

  it('persists updates back to localStorage', () => {
    const { result } = renderHook(() =>
      usePersistedNumber({ key: 'test:size', initial: 320, min: 200, max: 500 }),
    );
    act(() => result.current[1](420));
    expect(result.current[0]).toBe(420);
    expect(window.localStorage.getItem('test:size')).toBe('420');
  });

  it('ignores non-finite updates', () => {
    const { result } = renderHook(() =>
      usePersistedNumber({ key: 'test:size', initial: 320, min: 200, max: 500 }),
    );
    act(() => result.current[1](Number.NaN));
    expect(result.current[0]).toBe(320);
  });
});
