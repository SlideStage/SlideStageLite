import { describe, expect, it } from 'vitest';
import { splitReveal } from '@slidestage/core/converter/splitReveal';
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
  kind: 'reveal',
  confidence: 0.9,
  rootHtml: 'index.html',
  hints: { candidateRoots: ['index.html'] },
};

function makeReveal(body: string, head = '<title>Reveal Talk</title>'): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>
<div class="reveal"><div class="slides">
${body}
</div></div>
<script src="reveal.js"></script>
</body></html>`;
}

describe('splitReveal', () => {
  it('extracts top-level <section> children of .reveal > .slides and preserves the wrapper inside each emitted page', () => {
    const html = makeReveal(`
      <section><h1>Hello</h1><p>One</p></section>
      <section><h2>World</h2><p>Two</p></section>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.architecture).toBe('multi-file');
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].label).toBe('Hello');
    expect(result.slides[0].file).toBe('01-hello.html');
    expect(result.slides[1].label).toBe('World');
    expect(result.slides[1].file).toBe('02-world.html');

    const firstPage = decoder.decode(result.packEntries.get('01-hello.html')!);
    expect(firstPage).toContain('<div class="reveal"><div class="slides">');
    expect(firstPage).toContain('<section>');
    expect(firstPage).toContain('<h1>Hello</h1>');
    // Runtime script must be stripped from each emitted slide page.
    expect(firstPage).not.toMatch(/<script\b[^>]*reveal\.js/);
  });

  it('respects label precedence: first heading > data-title > Slide N', () => {
    const html = makeReveal(`
      <section data-title="Ignored Cover"><h1>Heading Wins</h1></section>
      <section data-title="Data Title Wins"><p>No heading</p></section>
      <section><p>No heading no data-title</p></section>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides[0].label).toBe('Heading Wins');
    expect(result.slides[1].label).toBe('Data Title Wins');
    expect(result.slides[2].label).toBe('Slide 3');
  });

  it('sets compat.requires when any section contains an inline <script>', () => {
    const html = makeReveal(`
      <section><h1>Static</h1></section>
      <section><h1>Dynamic</h1><script>console.log("hi")</script></section>
    `);

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.compat).not.toBeNull();
    expect(result.compat?.requires).toContain('same-origin-storage');
  });

  it('leaves compat null when no section contains an inline script', () => {
    const html = makeReveal('<section><h1>Static</h1></section>');
    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });
    expect(result.compat).toBeNull();
  });

  it('signals fallback (empty slides) when the .reveal container is missing', () => {
    const html = `<!doctype html><html><head><title>Empty</title></head><body>
      <div><p>No reveal wrapper here</p></div>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(0);
    expect(
      result.warnings.some(
        (w) => w.kind === 'note' && w.message.includes('<div class="reveal">'),
      ),
    ).toBe(true);
  });

  it('signals fallback when .reveal exists but .slides is missing', () => {
    const html = `<!doctype html><html><head><title>X</title></head><body>
      <div class="reveal"><p>I am wrapping in .reveal but no .slides</p></div>
      <script src="reveal.js"></script>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(0);
    expect(
      result.warnings.some(
        (w) => w.kind === 'note' && w.message.includes('<div class="slides">'),
      ),
    ).toBe(true);
  });

  it('signals fallback when .slides has no <section> children', () => {
    const html = makeReveal('<p>Only text, no sections</p>');

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.kind === 'note' && w.message.includes('<section>')),
    ).toBe(true);
  });

  it('writes per-slide pages in the same directory as the root html and excludes the root from packEntries', () => {
    const html = makeReveal(`
      <section><h1>One</h1></section>
      <section><h1>Two</h1></section>
    `);

    const entries = new Map<string, Uint8Array>([
      ['decks/keynote-2026/index.html', bytes(html)],
      ['decks/keynote-2026/assets/theme.css', bytes('body{}')],
    ]);

    const result = splitReveal({
      rootHtmlPath: 'decks/keynote-2026/index.html',
      entries,
      sniff: { ...sniffStub, rootHtml: 'decks/keynote-2026/index.html' },
    });

    expect(result.slides.map((s) => s.file)).toEqual([
      'decks/keynote-2026/01-one.html',
      'decks/keynote-2026/02-two.html',
    ]);
    expect(result.packEntries.has('decks/keynote-2026/assets/theme.css')).toBe(true);
    expect(result.packEntries.has('decks/keynote-2026/index.html')).toBe(false);
  });

  it('records a runtime-dropped warning when stripping reveal.js scripts', () => {
    const html = makeReveal('<section><h1>One</h1></section>');

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    const runtimeWarning = result.warnings.find(
      (w) => w.kind === 'runtime-dropped' && /reveal\.js/.test(w.reason),
    );
    expect(runtimeWarning).toBeDefined();
  });

  it('also strips reveal.js loaded from a CDN sub-path (reveal/dist/reveal.js)', () => {
    const html = `<!doctype html><html><head><title>CDN</title></head><body>
      <div class="reveal"><div class="slides">
        <section><h1>Cover</h1></section>
      </div></div>
      <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    const slidePage = decoder.decode(result.packEntries.get('01-cover.html')!);
    expect(slidePage).not.toContain('reveal.js');
  });

  it('emits a final "fragments and transitions are lost" note when slides are produced', () => {
    const html = makeReveal('<section><h1>One</h1></section>');

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitReveal({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    const note = result.warnings.find(
      (w) => w.kind === 'note' && w.message.includes('fragments'),
    );
    expect(note).toBeDefined();
  });
});
