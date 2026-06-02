import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DeckLoadError, type Manifest } from '@slidestage/core/deck/types';
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

describe('packStage · Zip Slip guard (DSS-CAND-008)', () => {
  it('rejects an entry that escapes the package root via ..', () => {
    const entries = new Map<string, Uint8Array>([
      ['../../evil.txt', bytesFromString('pwned')],
    ]);
    try {
      packStage(makeManifest(), entries);
      throw new Error('expected packStage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DeckLoadError);
      expect((error as DeckLoadError).code).toBe('E_PATH_TRAVERSAL');
    }
  });

  it('rejects an absolute entry path', () => {
    const entries = new Map<string, Uint8Array>([
      ['/etc/passwd', bytesFromString('root:x:0:0')],
    ]);
    expect(() => packStage(makeManifest(), entries)).toThrow(DeckLoadError);
  });

  it('normalizes backslash / dot segments instead of emitting them verbatim', () => {
    const entries = new Map<string, Uint8Array>([
      ['assets\\.\\style.css', bytesFromString('body{}')],
      ['slides/01-cover.html', bytesFromString('<html></html>')],
    ]);
    const unpacked = unzipSync(asPlainUint8(packStage(makeManifest(), entries)));
    expect(Object.keys(unpacked).sort()).toEqual(
      ['assets/style.css', 'manifest.json', 'slides/01-cover.html'].sort(),
    );
  });
});
