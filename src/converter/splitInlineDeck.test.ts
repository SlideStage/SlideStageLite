import { describe, expect, it } from 'vitest';
import { splitInlineDeck } from './splitInlineDeck';
import type { SniffResult } from './sniffer';

const encoder = new TextEncoder();
function asLocalBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}
function bytes(text: string): Uint8Array {
  return asLocalBytes(encoder.encode(text));
}

const sniffStub: SniffResult = {
  kind: 'inline-deck',
  confidence: 0.85,
  rootHtml: 'index.html',
  hints: { candidateRoots: ['index.html'], inlineSectionCount: 0 },
};

describe('splitInlineDeck', () => {
  it('extracts top-level <section class="slide"> blocks ignoring nested sections', () => {
    const html = `<!doctype html><html><head><title>T</title></head><body>
      <section class="slide" data-title="Outer">
        <h1>Outer slide</h1>
        <section class="footnote">nested non-slide</section>
        <section class="slide subnote">decorative nested .slide that we still treat as nested</section>
      </section>
      <section class="slide" data-title="Other">Other</section>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitInlineDeck({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].label).toBe('Outer');
    expect(result.slides[1].label).toBe('Other');

    const outerPage = result.packEntries.get(result.slides[0].file);
    expect(outerPage).toBeDefined();
    const outerText = new TextDecoder().decode(outerPage!);
    expect(outerText).toContain('nested non-slide');
    expect(outerText).toContain('decorative nested .slide');
  });

  it('signals fallback (empty slides) when nothing matches', () => {
    const html = `<!doctype html><html><head><title>Empty</title></head><body>
      <div class="deck">No sections at all</div>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([['index.html', bytes(html)]]);
    const result = splitInlineDeck({ rootHtmlPath: 'index.html', entries, sniff: sniffStub });

    expect(result.slides).toHaveLength(0);
    // The original entry must remain in packEntries so the caller can hand off
    // to wrapSource without re-reading the source.
    expect(result.packEntries.has('index.html')).toBe(true);
  });

  it('writes per-slide pages in the same directory as the root html', () => {
    const html = `<!doctype html><html><head><title>Nested root</title></head><body>
      <section class="slide" data-title="One"><h1>One</h1></section>
      <section class="slide" data-title="Two"><h1>Two</h1></section>
    </body></html>`;

    const entries = new Map<string, Uint8Array>([
      ['decks/talk-2026/index.html', bytes(html)],
      ['decks/talk-2026/assets/theme.css', bytes('body{}')],
    ]);
    const result = splitInlineDeck({
      rootHtmlPath: 'decks/talk-2026/index.html',
      entries,
      sniff: { ...sniffStub, rootHtml: 'decks/talk-2026/index.html' },
    });

    expect(result.slides.map((s) => s.file)).toEqual([
      'decks/talk-2026/01-one.html',
      'decks/talk-2026/02-two.html',
    ]);
    expect(result.packEntries.has('decks/talk-2026/assets/theme.css')).toBe(true);
    expect(result.packEntries.has('decks/talk-2026/index.html')).toBe(false);
  });
});
