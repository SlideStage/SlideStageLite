import { describe, expect, it } from 'vitest';
import { sniffDeck, type SniffResult } from './sniffer';
import { buildManifestFromSource } from './buildManifest';

const encoder = new TextEncoder();

function entries(...pairs: Array<[string, string]>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const [path, value] of pairs) {
    map.set(path, encoder.encode(value));
  }
  return map;
}

const fileOptions = {
  fileName: 'demo-deck.zip',
  fileSize: 1024,
  fileLastModified: Date.UTC(2026, 0, 1),
};

describe('buildManifestFromSource', () => {
  it('emits a wrapper slide for inline-deck and preserves section count in the label', () => {
    const html = `<!doctype html><html><head><title>My Inline Deck</title></head><body>
      <div class="deck">
        <section class="slide">A</section>
        <section class="slide">B</section>
        <section class="slide">C</section>
      </div>
      <script src="runtime.js"></script>
    </body></html>`;
    const map = entries(['index.html', html]);
    const sniff = sniffDeck(map);
    const manifest = buildManifestFromSource(sniff, map, fileOptions);

    expect(manifest.architecture).toBe('single-file-html');
    expect(manifest.totalSlides).toBe(1);
    expect(manifest.slides[0].file).toBe('index.html');
    expect(manifest.slides[0].label).toContain('3 sections');
    expect(manifest.title).toBe('My Inline Deck');
  });

  it('emits a wrapper slide for webcomponent-deck', () => {
    const html = `<deck-stage>
      <deck-slide>1</deck-slide>
      <deck-slide>2</deck-slide>
    </deck-stage>`;
    const map = entries(['index.html', html]);
    const sniff = sniffDeck(map);
    const manifest = buildManifestFromSource(sniff, map, fileOptions);
    expect(manifest.architecture).toBe('single-file-html');
    expect(manifest.slides).toHaveLength(1);
  });

  it('expands router-html DECK_MANIFEST into multiple slides', () => {
    const html = `<!doctype html><html><head><title>Router Deck</title></head><body><script>
      window.DECK_MANIFEST = [
        { file: "slides/01.html", label: "Cover" },
        { file: "slides/02.html", label: "Quote" }
      ];
    </script></body></html>`;
    const map = entries(
      ['index.html', html],
      ['slides/01.html', '<h1>Cover</h1>'],
      ['slides/02.html', '<h1>Quote</h1>'],
    );
    const sniff = sniffDeck(map);
    const manifest = buildManifestFromSource(sniff, map, fileOptions);
    expect(manifest.architecture).toBe('multi-file');
    expect(manifest.totalSlides).toBe(2);
    expect(manifest.slides.map((s) => s.file)).toEqual(['slides/01.html', 'slides/02.html']);
    expect(manifest.slides.map((s) => s.label)).toEqual(['Cover', 'Quote']);
    expect(manifest.slides.map((s) => s.index)).toEqual([1, 2]);
  });

  it('skips router-html entries whose files are missing', () => {
    const html = `<script>
      window.DECK_MANIFEST = [
        { file: "slides/present.html" },
        { file: "slides/missing.html" }
      ];
    </script>`;
    const map = entries(
      ['index.html', html],
      ['slides/present.html', '<h1>OK</h1>'],
    );
    const sniff = sniffDeck(map);
    const manifest = buildManifestFromSource(sniff, map, fileOptions);
    expect(manifest.totalSlides).toBe(1);
    expect(manifest.slides[0].file).toBe('slides/present.html');
  });

  it('falls back to a single wrapper slide when no router entries resolve', () => {
    const sniff: SniffResult = {
      kind: 'router-html',
      confidence: 0.5,
      rootHtml: 'index.html',
      hints: { routerManifest: [{ file: 'slides/missing.html' }] },
    };
    const map = entries(['index.html', '<script>window.DECK_MANIFEST = []</script>']);
    const manifest = buildManifestFromSource(sniff, map, fileOptions);
    expect(manifest.totalSlides).toBe(1);
    expect(manifest.architecture).toBe('single-file-html');
  });

  it('emits a wrapper slide for plain-html and uses <title> when present', () => {
    const html = '<!doctype html><html><head><title>Plain Page</title></head><body>Hi</body></html>';
    const map = entries(['index.html', html]);
    const sniff = sniffDeck(map);
    const manifest = buildManifestFromSource(sniff, map, fileOptions);
    expect(manifest.architecture).toBe('single-file-html');
    expect(manifest.title).toBe('Plain Page');
    expect(manifest.totalSlides).toBe(1);
  });

  it('sanitizes a file name with separators into a valid manifest id', () => {
    const sniff: SniffResult = {
      kind: 'plain-html',
      confidence: 0.5,
      rootHtml: 'index.html',
      hints: {},
    };
    const map = entries(['index.html', '<h1>Hi</h1>']);
    const manifest = buildManifestFromSource(sniff, map, {
      ...fileOptions,
      fileName: 'subdir/../weird name with space.html',
    });
    expect(manifest.id).not.toContain('/');
    expect(manifest.id).not.toContain('..');
    expect(manifest.id).not.toContain(' ');
  });
});
