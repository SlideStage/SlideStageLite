import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  noopThumbnailCache,
  pickThumbnailCache,
  slideIdIsSafe,
  tauriThumbnailCache,
  thumbnailBytesToObjectUrl,
  __setInvokeForTests,
} from '@slidestage/lite-preset/desktop/thumbnailCache';

const invokeMock = vi.fn();

beforeEach(() => {
  invokeMock.mockReset();
  __setInvokeForTests(invokeMock);
});

afterEach(() => {
  __setInvokeForTests(null);
});

describe('slideIdIsSafe', () => {
  it.each([
    ['slide-1', true],
    ['root', true],
    ['Section_2.3', true],
    ['', false],
    ['.', false],
    ['..', false],
    ['slide/1', false],
    ['has space', false],
    ['$bad', false],
    ['a'.repeat(129), false],
  ])('verifies %s -> %s', (id, expected) => {
    expect(slideIdIsSafe(id)).toBe(expected);
  });
});

describe('noopThumbnailCache', () => {
  it('always misses on read', async () => {
    await expect(noopThumbnailCache.read('fp', 'slide-1')).resolves.toBeNull();
  });

  it('swallows writes / lists / clears', async () => {
    await expect(noopThumbnailCache.write('fp', 'slide-1', new Uint8Array([1]))).resolves.toBeUndefined();
    await expect(noopThumbnailCache.list('fp')).resolves.toEqual([]);
    await expect(noopThumbnailCache.clear('fp')).resolves.toBeUndefined();
  });
});

describe('tauriThumbnailCache', () => {
  it('rejects unsafe slideIds before touching the bridge', async () => {
    await expect(
      tauriThumbnailCache.read('fp', '../escape'),
    ).rejects.toThrow(/unsafe slideId/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe fingerprints before touching the bridge', async () => {
    await expect(
      tauriThumbnailCache.read('../oops', 'slide-1'),
    ).rejects.toThrow(/unsafe fingerprint/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects empty bytes on write', async () => {
    await expect(
      tauriThumbnailCache.write('fp', 'slide-1', new Uint8Array(0)),
    ).rejects.toThrow(/refusing to persist empty bytes/);
  });

  it('round-trips bytes through invoke', async () => {
    invokeMock.mockResolvedValueOnce([1, 2, 3]);
    const result = await tauriThumbnailCache.read('fp', 'slide-1');
    expect(invokeMock).toHaveBeenCalledWith('thumbnail_cache_get', {
      fingerprint: 'fp',
      slideId: 'slide-1',
    });
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('returns null when bridge has no cached entry', async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(tauriThumbnailCache.read('fp', 'slide-1')).resolves.toBeNull();
  });

  it('serialises bytes as plain arrays for invoke', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await tauriThumbnailCache.write('fp', 'slide-1', new Uint8Array([7, 8, 9]));
    expect(invokeMock).toHaveBeenCalledWith('thumbnail_cache_put', {
      fingerprint: 'fp',
      slideId: 'slide-1',
      bytes: [7, 8, 9],
    });
  });

  it('forwards list / clear with fingerprint only', async () => {
    invokeMock.mockResolvedValueOnce(['slide-a']);
    await expect(tauriThumbnailCache.list('fp')).resolves.toEqual(['slide-a']);

    invokeMock.mockResolvedValueOnce(undefined);
    await tauriThumbnailCache.clear('fp');
    expect(invokeMock).toHaveBeenLastCalledWith('thumbnail_cache_clear', { fingerprint: 'fp' });
  });
});

describe('pickThumbnailCache', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('returns the noop cache in plain jsdom', () => {
    expect(pickThumbnailCache()).toBe(noopThumbnailCache);
  });

  it('returns the Tauri cache once the host is detected', () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(pickThumbnailCache()).toBe(tauriThumbnailCache);
  });
});

describe('thumbnailBytesToObjectUrl', () => {
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('wraps bytes into a webp blob URL', () => {
    const url = thumbnailBytesToObjectUrl(new Uint8Array([1, 2, 3]));
    expect(url).toBe('blob:mock');
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBe(3);
  });
});
