import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseManifest, type ManifestWarning } from './manifestSchema';

const baseManifest = {
  schema: 'slidestage@1.0',
  id: 'lite-test',
  version: '1.0.0',
  title: 'Test deck',
  subtitle: null,
  author: null,
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  architecture: 'multi-file',
  dimensions: { width: 1920, height: 1080 },
  totalSlides: 1,
  slides: [
    {
      index: 1,
      id: 'only',
      label: 'Only',
      file: 'slides/01-only.html',
      thumbnail: null,
      notes: null,
    },
  ],
} as const;

function withSlides(slides: Array<{ index: number; id: string; label: string; file: string }>) {
  return {
    ...baseManifest,
    totalSlides: slides.length,
    slides: slides.map((s) => ({ ...s, thumbnail: null, notes: null })),
  };
}

describe('parseManifest · id relaxation', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('accepts ids that contain spaces and punctuation', () => {
    const manifest = parseManifest({
      ...baseManifest,
      id: 'Acme Corp — Q4 2026 Pitch (Final)',
    });
    expect(manifest.id).toBe('Acme Corp — Q4 2026 Pitch (Final)');
  });

  it('accepts mixed-case ids', () => {
    const manifest = parseManifest({ ...baseManifest, id: 'MixedCaseID-2026' });
    expect(manifest.id).toBe('MixedCaseID-2026');
  });

  it('rejects empty ids', () => {
    expect(() => parseManifest({ ...baseManifest, id: '' })).toThrow();
  });

  it('rejects ids that exceed 128 characters', () => {
    expect(() => parseManifest({ ...baseManifest, id: 'x'.repeat(129) })).toThrow();
  });

  it('rejects ids containing NUL, "/", "\\" or ".."', () => {
    for (const bad of ['has/slash', 'has\\back', 'has\0nul', '..parent', 'nested/..']) {
      expect(() => parseManifest({ ...baseManifest, id: bad })).toThrow();
    }
  });

  it('rejects ids containing control characters', () => {
    expect(() => parseManifest({ ...baseManifest, id: 'has\u0007bell' })).toThrow();
  });
});

describe('parseManifest · totalSlides relaxation', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('normalizes totalSlides to slides.length when they mismatch and warns', () => {
    const warnings: ManifestWarning[] = [];
    const manifest = parseManifest(
      {
        ...withSlides([
          { index: 1, id: 'a', label: 'A', file: 'slides/a.html' },
          { index: 2, id: 'b', label: 'B', file: 'slides/b.html' },
        ]),
        totalSlides: 7,
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(manifest.totalSlides).toBe(2);
    expect(warnings.find((w) => w.code === 'totalSlidesMismatch')).toEqual({
      code: 'totalSlidesMismatch',
      declared: 7,
      actual: 2,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not warn when totalSlides matches', () => {
    const warnings: ManifestWarning[] = [];
    parseManifest(
      withSlides([{ index: 1, id: 'a', label: 'A', file: 'slides/a.html' }]),
      { onWarning: (w) => warnings.push(w) },
    );
    expect(warnings.find((w) => w.code === 'totalSlidesMismatch')).toBeUndefined();
  });
});

describe('parseManifest · index renumbering', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('renumbers slides[].index by array order when non-sequential and warns', () => {
    const warnings: ManifestWarning[] = [];
    const manifest = parseManifest(
      withSlides([
        { index: 5, id: 'a', label: 'A', file: 'slides/a.html' },
        { index: 9, id: 'b', label: 'B', file: 'slides/b.html' },
        { index: 12, id: 'c', label: 'C', file: 'slides/c.html' },
      ]),
      { onWarning: (w) => warnings.push(w) },
    );

    expect(manifest.slides.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(warnings.find((w) => w.code === 'slideIndexRenumbered')).toEqual({
      code: 'slideIndexRenumbered',
      originalIndices: [5, 9, 12],
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not renumber when indices are already sequential', () => {
    const warnings: ManifestWarning[] = [];
    parseManifest(
      withSlides([
        { index: 1, id: 'a', label: 'A', file: 'slides/a.html' },
        { index: 2, id: 'b', label: 'B', file: 'slides/b.html' },
      ]),
      { onWarning: (w) => warnings.push(w) },
    );
    expect(warnings.find((w) => w.code === 'slideIndexRenumbered')).toBeUndefined();
  });
});

describe('parseManifest · architecture enum', () => {
  it.each([
    'multi-file',
    'multi-file-flat',
    'single-file-deckstage',
    'single-file-html',
  ] as const)('accepts architecture %s', (architecture) => {
    const manifest = parseManifest({ ...baseManifest, architecture });
    expect(manifest.architecture).toBe(architecture);
  });

  it.each(['inline-deck', 'webcomponent-deck', 'router-html', 'auto'] as const)(
    'rejects non-standard source-kind architecture %s',
    (architecture) => {
      expect(() => parseManifest({ ...baseManifest, architecture })).toThrow();
    },
  );

  it('rejects unknown architecture values', () => {
    expect(() => parseManifest({ ...baseManifest, architecture: 'mystery' })).toThrow();
  });
});

describe('parseManifest · provenance and compat', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('preserves generic provenance metadata', () => {
    const manifest = parseManifest({
      ...baseManifest,
      provenance: {
        sourceKind: 'webcomponent-deck',
        conversionMode: 'wrap',
        sourceEntry: 'index.html',
        converter: { name: 'slidestage-converter', version: '0.1.0' },
      },
    });

    expect(manifest.provenance).toMatchObject({
      sourceKind: 'webcomponent-deck',
      conversionMode: 'wrap',
      sourceEntry: 'index.html',
      converter: { name: 'slidestage-converter', version: '0.1.0' },
    });
  });

  it('drops unknown compat.requires values with a warning', () => {
    const warnings: ManifestWarning[] = [];
    const manifest = parseManifest(
      {
        ...baseManifest,
        compat: {
          requires: ['window-open', 'future-capability', 'window-open'],
        },
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(manifest.compat?.requires).toEqual(['window-open']);
    expect(warnings).toContainEqual({
      code: 'unknownCompatCapability',
      capability: 'future-capability',
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rejects manifests that require a newer platform schema', () => {
    expect(() =>
      parseManifest({
        ...baseManifest,
        platform: {
          minSchemaVersion: '2.0',
          compatibleArchitectures: ['multi-file'],
        },
      }),
    ).toThrow(/platform schema/);
  });
});

describe('parseManifest · offline', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('preserves a well-formed offline block', () => {
    const manifest = parseManifest({
      ...baseManifest,
      offline: {
        ready: true,
        mirroredAt: '2026-05-15T12:00:00.000Z',
        mirrorTool: { name: 'slidestage-mirror', version: '0.1.0' },
        policy: {
          includeScripts: false,
          includeIframes: false,
          maxAssetBytes: 50 * 1024 * 1024,
          maxTotalBytes: 500 * 1024 * 1024,
        },
        mirroredAssets: [
          {
            originalUrl: 'https://images.example.com/hero.png',
            path: 'assets/_mirror/img/abc123.png',
            contentHash: 'sha256-aabbccdd',
            contentType: 'image/png',
            bytes: 4096,
            fetchedAt: '2026-05-15T12:00:00.000Z',
            referencedBy: [1],
          },
        ],
        skippedUrls: [],
      },
    });

    expect(manifest.offline?.ready).toBe(true);
    expect(manifest.offline?.mirroredAssets).toHaveLength(1);
    expect(manifest.offline?.mirroredAssets[0].originalUrl).toBe(
      'https://images.example.com/hero.png',
    );
    expect(manifest.offline?.policy?.maxAssetBytes).toBe(50 * 1024 * 1024);
  });

  it('accepts ready=false with a skipped URL', () => {
    const manifest = parseManifest({
      ...baseManifest,
      offline: {
        ready: false,
        mirroredAt: '2026-05-15T12:00:00.000Z',
        mirrorTool: { name: 'slidestage-mirror' },
        mirroredAssets: [],
        skippedUrls: [
          { url: 'https://example.com/broken', reason: 'unreachable', detail: 'HTTP 404' },
        ],
      },
    });
    expect(manifest.offline?.ready).toBe(false);
    expect(manifest.offline?.skippedUrls[0].reason).toBe('unreachable');
  });

  it('rejects skipped URL entries with an unknown reason', () => {
    expect(() =>
      parseManifest({
        ...baseManifest,
        offline: {
          ready: false,
          mirroredAt: '2026-05-15T12:00:00.000Z',
          mirrorTool: { name: 'slidestage-mirror' },
          mirroredAssets: [],
          skippedUrls: [{ url: 'https://example.com', reason: 'mystery' }],
        },
      }),
    ).toThrow();
  });

  it('treats offline as fully optional', () => {
    expect(parseManifest({ ...baseManifest }).offline).toBeUndefined();
  });
});
