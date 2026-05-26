import { describe, expect, it } from 'vitest';
import { splitImpress } from '@slidestage/core/converter/splitImpress';
import type { SniffResult } from '@slidestage/core/converter/sniffer';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function asLocalBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function bytes(text: string): Uint8Array {
  return asLocalBytes(encoder.encode(text));
}

const sniffStub: SniffResult = {
  kind: 'impress',
  confidence: 0.9,
  rootHtml: 'index.html',
  hints: { candidateRoots: ['index.html'] },
};

function makeImpress(body: string, head = '<title>Impress Talk</title>'): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>
<div id="impress">
${body}
</div>
<script src="impress.js"></script>
<script>impress().init();</script>
</body></html>`;
}

describe('splitImpress', () => {
  it('extracts top-level .step blocks inside #impress and preserves the wrapper inside each emitted page', () => {
    const html = makeImpress(`
      <div class="step" id="bored"><h1>Bored</h1></div>
      <div class="step" id="prezi"><h1>Prezi</h1></div>
      <div class="step" id="impressed"><h1>Impressed</h1></div>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.architecture).toBe('multi-file');
    expect(result.slides).toHaveLength(3);
    expect(result.slides.map((s) => s.label)).toEqual(['Bored', 'Prezi', 'Impressed']);
    expect(result.slides.map((s) => s.id)).toEqual(['bored', 'prezi', 'impressed']);
    expect(result.slides.map((s) => s.file)).toEqual([
      '01-bored.html',
      '02-prezi.html',
      '03-impressed.html',
    ]);

    const firstPage = decoder.decode(result.packEntries.get('01-bored.html')!);
    expect(firstPage).toContain('<div id="impress">');
    expect(firstPage).toContain('<div class="step" id="bored">');
    expect(firstPage).toContain('<h1>Bored</h1>');
    expect(firstPage).not.toMatch(/<script\b[^>]*impress\.js/);
  });

  it('prefers step id over slug-derived label for slide.id', () => {
    const html = makeImpress(`
      <div class="step" id="kept-id"><h1>Different Heading</h1></div>
      <div class="step"><h1>No Id</h1></div>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides[0].id).toBe('kept-id');
    // When there's no id we fall back to slug.
    expect(result.slides[1].id).toBe('no-id');
  });

  it('respects label precedence: first heading > step id > Step N', () => {
    const html = makeImpress(`
      <div class="step" id="ignored"><h1>Heading Wins</h1></div>
      <div class="step" id="step-id-wins"><p>No heading</p></div>
      <div class="step"><p>No heading no id</p></div>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides[0].label).toBe('Heading Wins');
    expect(result.slides[1].label).toBe('step-id-wins');
    expect(result.slides[2].label).toBe('Step 3');
  });

  it('sets compat.requires when any step contains an inline <script>', () => {
    const html = makeImpress(`
      <div class="step" id="static"><h1>Static</h1></div>
      <div class="step" id="dynamic"><h1>Dynamic</h1><script>doStuff()</script></div>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.compat).not.toBeNull();
    expect(result.compat?.requires).toContain('same-origin-storage');
  });

  it('signals fallback when no .step children exist', () => {
    const html = `<!doctype html><html><head><title>Empty</title></head><body>
      <div id="impress"><p>No steps</p></div>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(0);
    expect(result.warnings.some((w) => w.kind === 'note' && w.message.includes('step'))).toBe(true);
  });

  it('scopes the .step search to #impress (ignores .step blocks outside the impress wrapper)', () => {
    const html = `<!doctype html><html><head><title>Scoped</title></head><body>
      <nav><div class="step nav-link">Decorative .step in nav</div></nav>
      <div id="impress">
        <div class="step" id="a"><h1>A</h1></div>
        <div class="step" id="b"><h1>B</h1></div>
      </div>
      <script src="impress.js"></script>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    // Only the two real impress steps make it through; the nav decorative
    // .step is ignored because it is outside the #impress wrapper.
    expect(result.slides).toHaveLength(2);
    expect(result.slides.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('falls back to scanning the full document when no #impress wrapper exists', () => {
    const html = `<!doctype html><html><head><title>Wrapperless</title></head><body>
      <div class="step" id="one"><h1>One</h1></div>
      <div class="step" id="two"><h1>Two</h1></div>
      <script src="impress.js"></script>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(2);
    expect(result.slides.map((s) => s.id)).toEqual(['one', 'two']);
  });

  it('writes per-step pages in the same directory as the root html and excludes the root from packEntries', () => {
    const html = makeImpress(`
      <div class="step" id="cover"><h1>Cover</h1></div>
      <div class="step" id="finale"><h1>Finale</h1></div>
    `);

    const entries = new Map<string, Uint8Array>([
      ['decks/talk-2026/index.html', bytes(html)],
      ['decks/talk-2026/assets/theme.css', bytes('body{}')],
    ]);

    const result = splitImpress({
      rootHtmlPath: 'decks/talk-2026/index.html',
      entries,
      sniff: { ...sniffStub, rootHtml: 'decks/talk-2026/index.html' },
    });

    expect(result.slides.map((s) => s.file)).toEqual([
      'decks/talk-2026/01-cover.html',
      'decks/talk-2026/02-finale.html',
    ]);
    expect(result.packEntries.has('decks/talk-2026/assets/theme.css')).toBe(true);
    expect(result.packEntries.has('decks/talk-2026/index.html')).toBe(false);
  });

  it('records a runtime-dropped warning when stripping impress.js scripts', () => {
    const html = makeImpress('<div class="step" id="one"><h1>One</h1></div>');

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    const runtimeWarning = result.warnings.find(
      (w) => w.kind === 'runtime-dropped' && /impress\.js/.test(w.reason),
    );
    expect(runtimeWarning).toBeDefined();
  });

  it('emits a final "3D camera transitions are lost" note when slides are produced', () => {
    const html = makeImpress('<div class="step" id="one"><h1>One</h1></div>');

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitImpress({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    const note = result.warnings.find((w) => w.kind === 'note' && w.message.includes('3D camera'));
    expect(note).toBeDefined();
  });
});
