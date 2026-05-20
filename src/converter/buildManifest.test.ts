import { describe, expect, it } from 'vitest';
import { buildManifestFromSource } from '@slidestage/core/converter/buildManifest';
import type { SniffResult } from '@slidestage/core/converter/sniffer';

const encoder = new TextEncoder();

function entries(...pairs: Array<[string, string | Uint8Array]>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const [path, value] of pairs) {
    map.set(path, typeof value === 'string' ? encoder.encode(value) : value);
  }
  return map;
}

const baseOptions = {
  fileName: 'deck',
  fileLastModified: Date.UTC(2026, 0, 1),
  fileSize: 0,
};

function routerSniff(rootHtml = 'index.html'): SniffResult {
  return {
    kind: 'router-html',
    confidence: 1,
    rootHtml,
    hints: {
      routerManifest: [
        { file: 'slides/01-cover.html', label: 'Cover' },
        { file: 'slides/02-tldr.html', label: 'TL;DR' },
        { file: 'slides/03-no-notes.html', label: 'Empty' },
      ],
    },
  };
}

describe('buildManifestFromSource · speaker_note extraction (router-html)', () => {
  it('fills slides[].notes from speaker-notes/<basename>.md when present', () => {
    const manifest = buildManifestFromSource(
      routerSniff(),
      entries(
        ['index.html', '<!doctype html><title>Router</title><body></body>'],
        ['slides/01-cover.html', '<h1>Cover</h1>'],
        ['slides/02-tldr.html', '<h1>TL;DR</h1>'],
        ['slides/03-no-notes.html', '<h1>Empty</h1>'],
        ['speaker-notes/01-cover.md', '  Cover prose here.\nMore detail.\n'],
        ['speaker-notes/02-tldr.md', 'TL;DR speaker prose.'],
      ),
      baseOptions,
    );

    expect(manifest.slides[0].notes).toBe('Cover prose here.\nMore detail.');
    expect(manifest.slides[1].notes).toBe('TL;DR speaker prose.');
    expect(manifest.slides[2].notes).toBeNull();
  });

  it('falls back to notes/<basename>.md when speaker-notes/ is absent', () => {
    const manifest = buildManifestFromSource(
      routerSniff(),
      entries(
        ['index.html', '<!doctype html><title>Router</title>'],
        ['slides/01-cover.html', '<h1>Cover</h1>'],
        ['slides/02-tldr.html', '<h1>TL;DR</h1>'],
        ['slides/03-no-notes.html', '<h1>Empty</h1>'],
        ['notes/01-cover.md', 'From notes dir.'],
      ),
      baseOptions,
    );

    expect(manifest.slides[0].notes).toBe('From notes dir.');
    expect(manifest.slides[1].notes).toBeNull();
  });

  it('falls back to <slide-dir>/<basename>.notes.md (co-located attachment)', () => {
    const manifest = buildManifestFromSource(
      routerSniff(),
      entries(
        ['index.html', '<!doctype html><title>Router</title>'],
        ['slides/01-cover.html', '<h1>Cover</h1>'],
        ['slides/01-cover.notes.md', 'Co-located note.'],
        ['slides/02-tldr.html', '<h1>TL;DR</h1>'],
        ['slides/03-no-notes.html', '<h1>Empty</h1>'],
      ),
      baseOptions,
    );

    expect(manifest.slides[0].notes).toBe('Co-located note.');
    expect(manifest.slides[1].notes).toBeNull();
  });

  it('falls back to inline <aside class="notes"> inside the slide HTML', () => {
    const manifest = buildManifestFromSource(
      routerSniff(),
      entries(
        ['index.html', '<!doctype html><title>Router</title>'],
        [
          'slides/01-cover.html',
          '<h1>Cover</h1><aside class="notes"><p>Inline <em>aside</em> note.</p></aside>',
        ],
        ['slides/02-tldr.html', '<h1>TL;DR</h1>'],
        [
          'slides/03-no-notes.html',
          '<h1>Empty</h1><template id="speaker-notes">Templated note.</template>',
        ],
      ),
      baseOptions,
    );

    expect(manifest.slides[0].notes).toBe('Inline aside note.');
    expect(manifest.slides[1].notes).toBeNull();
    expect(manifest.slides[2].notes).toBe('Templated note.');
  });

  it('prefers the sidecar markdown over inline HTML when both exist', () => {
    const manifest = buildManifestFromSource(
      routerSniff(),
      entries(
        ['index.html', '<!doctype html><title>Router</title>'],
        [
          'slides/01-cover.html',
          '<h1>Cover</h1><aside class="notes">inline-only</aside>',
        ],
        ['speaker-notes/01-cover.md', 'sidecar wins'],
        ['slides/02-tldr.html', '<h1>TL;DR</h1>'],
        ['slides/03-no-notes.html', '<h1>Empty</h1>'],
      ),
      baseOptions,
    );

    expect(manifest.slides[0].notes).toBe('sidecar wins');
  });

  it('truncates absurdly long notes to a safe upper bound (~16 KB)', () => {
    const huge = 'x'.repeat(20_000);
    const manifest = buildManifestFromSource(
      routerSniff(),
      entries(
        ['index.html', '<!doctype html><title>Router</title>'],
        ['slides/01-cover.html', '<h1>Cover</h1>'],
        ['slides/02-tldr.html', '<h1>TL;DR</h1>'],
        ['slides/03-no-notes.html', '<h1>Empty</h1>'],
        ['speaker-notes/01-cover.md', huge],
      ),
      baseOptions,
    );

    expect(manifest.slides[0].notes).not.toBeNull();
    expect(manifest.slides[0].notes!.length).toBe(16_384);
  });
});

describe('buildManifestFromSource · speaker_note extraction (single-wrapper modes)', () => {
  it('extracts notes for plain-html via inline aside', () => {
    const sniff: SniffResult = {
      kind: 'plain-html',
      confidence: 1,
      rootHtml: 'index.html',
    };
    const manifest = buildManifestFromSource(
      sniff,
      entries([
        'index.html',
        '<!doctype html><title>Solo</title><h1>Solo deck</h1><aside class="notes">Solo notes prose.</aside>',
      ]),
      baseOptions,
    );

    expect(manifest.slides).toHaveLength(1);
    expect(manifest.slides[0].notes).toBe('Solo notes prose.');
  });

  it('returns null notes when no convention matches', () => {
    const sniff: SniffResult = {
      kind: 'plain-html',
      confidence: 1,
      rootHtml: 'index.html',
    };
    const manifest = buildManifestFromSource(
      sniff,
      entries(['index.html', '<!doctype html><title>Bare</title><h1>Bare deck</h1>']),
      baseOptions,
    );
    expect(manifest.slides[0].notes).toBeNull();
  });
});
