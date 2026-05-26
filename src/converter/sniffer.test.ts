import { describe, expect, it } from 'vitest';
import { sniffDeck } from '@slidestage/core/converter/sniffer';

const encoder = new TextEncoder();

function entries(...pairs: Array<[string, string | Uint8Array]>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const [path, value] of pairs) {
    map.set(path, typeof value === 'string' ? encoder.encode(value) : value);
  }
  return map;
}

describe('sniffDeck', () => {
  it('detects slidestage@1.0 when manifest.json is present', () => {
    const result = sniffDeck(entries(['manifest.json', '{}']));
    expect(result.kind).toBe('slidestage@1.0');
    expect(result.confidence).toBe(1);
  });

  it('reports empty when no HTML or manifest is present', () => {
    const result = sniffDeck(entries(['readme.txt', 'no html here']));
    expect(result.kind).toBe('empty');
  });

  it('detects inline-deck via .deck wrapper + .slide sections', () => {
    const html = `<!doctype html><html><body><div class="deck">
      <section class="slide" data-title="Cover"><h1>One</h1></section>
      <section class="slide" data-title="Two"><h1>Two</h1></section>
    </div><script src="runtime.js"></script></body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('inline-deck');
    expect(result.rootHtml).toBe('index.html');
    expect(result.hints?.inlineSectionCount).toBe(2);
    expect(result.hints?.inlineSectionLabels).toEqual(['Cover', 'Two']);
  });

  it('detects inline-deck via runtime.js reference even without explicit .deck wrapper', () => {
    const html = `<!doctype html><html><body>
      <section class="slide">One</section>
      <section class="slide">Two</section>
      <script src="assets/runtime.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('inline-deck');
  });

  it('detects webcomponent-deck via <deck-stage> and counts <deck-slide> children', () => {
    const html = `<!doctype html><html><body>
      <deck-stage>
        <deck-slide data-title="A">One</deck-slide>
        <deck-slide data-title="B">Two</deck-slide>
      </deck-stage>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('webcomponent-deck');
    expect(result.rootHtml).toBe('index.html');
    expect(result.hints?.inlineSectionCount).toBe(2);
    expect(result.hints?.inlineSectionLabels).toEqual(['A', 'B']);
  });

  it('detects router-html via window.DECK_MANIFEST JSON-like literal', () => {
    const html = `<!doctype html><html><body><script>
      window.DECK_MANIFEST = [
        { "file": "slides/01.html", "label": "Cover" },
        { "file": "slides/02.html", "label": "Body" }
      ];
    </script></body></html>`;
    const result = sniffDeck(
      entries(
        ['index.html', html],
        ['slides/01.html', '<h1>One</h1>'],
        ['slides/02.html', '<h1>Two</h1>'],
      ),
    );
    expect(result.kind).toBe('router-html');
    expect(result.hints?.routerManifest).toEqual([
      { file: 'slides/01.html', label: 'Cover' },
      { file: 'slides/02.html', label: 'Body' },
    ]);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('parses router-html with JS-literal shorthand (unquoted keys, single quotes, trailing comma)', () => {
    const html = `<script>
      window.DECK_MANIFEST = [
        { file: 'slides/01.html', label: "Cover" },
        { file: 'slides/02.html', label: 'Body' },
      ];
    </script>`;
    const result = sniffDeck(
      entries(
        ['index.html', html],
        ['slides/01.html', '<h1>One</h1>'],
        ['slides/02.html', '<h1>Two</h1>'],
      ),
    );
    expect(result.kind).toBe('router-html');
    expect(result.hints?.routerManifest?.length).toBe(2);
  });

  it('lowers confidence on router-html when referenced slides are missing', () => {
    const html = `<script>
      window.DECK_MANIFEST = [{ "file": "slides/missing.html" }];
    </script>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('router-html');
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('falls back to plain-html for a single non-deck HTML', () => {
    const html = '<!doctype html><html><body><h1>Hello</h1></body></html>';
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('plain-html');
  });

  it('returns ambiguous when multiple root HTMLs and no index.html', () => {
    const result = sniffDeck(
      entries(
        ['a.html', '<h1>A</h1>'],
        ['b.html', '<h1>B</h1>'],
      ),
    );
    expect(result.kind).toBe('ambiguous');
    expect(result.hints?.candidateRoots).toEqual(['a.html', 'b.html']);
  });

  it('picks index.html over sibling HTMLs', () => {
    const result = sniffDeck(
      entries(
        ['cover.html', '<h1>A</h1>'],
        ['index.html', '<h1>Index</h1>'],
      ),
    );
    expect(result.kind).toBe('plain-html');
    expect(result.rootHtml).toBe('index.html');
  });

  it('picks the only root HTML when no index.html exists', () => {
    const result = sniffDeck(
      entries(
        ['cover.html', '<h1>Cover</h1>'],
        ['assets/footer.html', '<footer />'],
      ),
    );
    expect(result.kind).toBe('plain-html');
    expect(result.rootHtml).toBe('cover.html');
  });

  it('does not crash when the inline-deck heuristic only finds class attribute without runtime', () => {
    const html = `<section class="slide">Only one section, no runtime</section>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('plain-html');
  });

  it('detects reveal via the .reveal + .slides div pair (no script reference required)', () => {
    const html = `<!doctype html><html><body>
      <div class="reveal"><div class="slides">
        <section><h1>One</h1></section>
        <section><h1>Two</h1></section>
      </div></div>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('reveal');
    expect(result.rootHtml).toBe('index.html');
  });

  it('detects reveal via a reveal.js script src even without explicit .reveal/.slides wrappers', () => {
    const html = `<!doctype html><html><body>
      <section><h1>One</h1></section>
      <script src="dist/reveal.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('reveal');
  });

  it('detects reveal via reveal.min.js (CDN minified bundle)', () => {
    const html = `<!doctype html><html><body>
      <section><h1>One</h1></section>
      <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.min.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('reveal');
  });

  it('prefers reveal over inline-deck when both shapes appear (reveal has higher priority)', () => {
    // Has .deck wrapper + .slide sections (inline-deck shape) AND .reveal/.slides
    // (reveal shape). reveal must win because it's evaluated first.
    const html = `<!doctype html><html><body>
      <div class="deck">
        <div class="reveal"><div class="slides">
          <section class="slide"><h1>One</h1></section>
        </div></div>
      </div>
      <script src="runtime.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('reveal');
  });

  it('detects impress via the <div id="impress"> wrapper', () => {
    const html = `<!doctype html><html><body>
      <div id="impress">
        <div class="step"><h1>One</h1></div>
        <div class="step"><h1>Two</h1></div>
      </div>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('impress');
    expect(result.rootHtml).toBe('index.html');
  });

  it('detects impress via an impress.js script src even without a #impress wrapper', () => {
    const html = `<!doctype html><html><body>
      <div class="step">A</div>
      <script src="js/impress.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('impress');
  });

  it('detects impress via impress.min.js (minified bundle)', () => {
    const html = `<!doctype html><html><body>
      <p>No wrapper</p>
      <script src="vendor/impress.min.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('impress');
  });

  it('prefers impress over inline-deck when both shapes appear', () => {
    const html = `<!doctype html><html><body>
      <div class="deck">
        <div id="impress">
          <div class="step"><h1>One</h1></div>
        </div>
      </div>
      <script src="runtime.js"></script>
    </body></html>`;
    const result = sniffDeck(entries(['index.html', html]));
    expect(result.kind).toBe('impress');
  });
});
