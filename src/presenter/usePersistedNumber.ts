import { useCallback, useEffect, useState } from 'react';

export interface PersistedNumberOptions {
  key: string;
  initial: number;
  min: number;
  max: number;
}

function readStored({ key, initial, min, max }: PersistedNumberOptions): number {
  if (typeof window === 'undefined') return initial;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return initial;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return initial;
    return Math.min(max, Math.max(min, parsed));
  } catch {
    return initial;
  }
}

export function usePersistedNumber(
  opts: PersistedNumberOptions,
): [number, (next: number | ((prev: number) => number)) => void] {
  const [value, setValue] = useState<number>(() => readStored(opts));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(opts.key, String(value));
    } catch {
      // localStorage may be unavailable (private mode); ignore.
    }
  }, [opts.key, value]);

  const setClamped = useCallback(
    (next: number | ((prev: number) => number)) => {
      setValue((prev) => {
        const raw = typeof next === 'function' ? (next as (p: number) => number)(prev) : next;
        if (!Number.isFinite(raw)) return prev;
        return Math.min(opts.max, Math.max(opts.min, raw));
      });
    },
    [opts.min, opts.max],
  );

  return [value, setClamped];
}
