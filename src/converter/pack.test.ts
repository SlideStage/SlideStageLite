import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '@slidestage/core/deck/types';
import { packStage, asPlainUint8, bytesFromString } from '@slidestage/core/converter/pack';

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schema: 'slidestage@1.0',
    id: 'pack-test',
    version: '1.0.0',
    title: 'Pack Test',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1280, height: 720 },
    totalSlides: 1,
    slides: [
      {
        index: 1,
        id: 'cover',
        label: 'Cover',
        file: 'slides/01-cover.html',
        thumbnail: null,
        notes: null,
      },
    ],
    ...overrides,
  };
}

function makeEntries(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['slides/01-cover.html', bytesFromString('<html><body>cover</body></html>')],
    ['assets/style.css', bytesFromString('body { background: white; }')],
  ]);
}

describe('packStage · determinism', () => {
  it('produces byte-identical zips for byte-identical inputs across calls', () => {
    const manifest = makeManifest();
    const a = packStage(manifest, makeEntries());
    const b = packStage(manifest, makeEntries());
    expect(Array.from(asPlainUint8(a))).toEqual(Array.from(asPlainUint8(b)));
  });

  it('changes only when manifest createdAt drifts', () => {
    const stable = packStage(makeManifest(), makeEntries());
    const drifted = packStage(
      makeManifest({ createdAt: '2025-06-15T12:00:00.000Z', updatedAt: '2025-06-15T12:00:00.000Z' }),
      makeEntries(),
    );
    expect(Array.from(asPlainUint8(stable))).not.toEqual(Array.from(asPlainUint8(drifted)));
  });

  it('round-trips through unzipSync with all entries intact', () => {
    const manifest = makeManifest();
    const bytes = packStage(manifest, makeEntries());
    const unpacked = unzipSync(asPlainUint8(bytes));
    expect(Object.keys(unpacked).sort()).toEqual(
      ['assets/style.css', 'manifest.json', 'slides/01-cover.html'].sort(),
    );
    const parsed = JSON.parse(new TextDecoder().decode(unpacked['manifest.json']));
    expect(parsed.id).toBe('pack-test');
  });
});
