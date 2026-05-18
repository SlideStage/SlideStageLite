import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { convertFolderSource, convertSource } from './index';
import { loadDeck } from '../deck/loadDeck';
import { DeckLoadError } from '../deck/types';

const validBasicPath = resolve('tests/fixtures/valid-basic.hcslides');
const plainHtmlPath = resolve('tests/fixtures/sources/plain-page.html');
const inlineDeckPath = resolve('tests/fixtures/sources/html-ppt-inline-deck.zip');
const webComponentPath = resolve('tests/fixtures/sources/huashu-webcomponent-deck.zip');
const routerPath = resolve('tests/fixtures/sources/huashu-router.zip');

const realmEncoder = new TextEncoder();

function asLocalBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  // Coerce to a realm-local Uint8Array (see pack.ts asPlainUint8 for context).
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

async function readSource(path: string) {
  const bytes = asLocalBytes(await readFile(path));
  return { bytes, name: path.split('/').pop()!, lastModified: 0 };
}

async function buildLocalZip(files: Record<string, string>): Promise<Uint8Array> {
  const { zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) {
    // jsdom's TextEncoder returns a Uint8Array whose prototype does not match
    // the realm-local Uint8Array.prototype that fflate captured at load time,
    // so we have to re-wrap before handing the bytes to zipSync. (See the
    // identical asPlainUint8 dance in src/converter/pack.ts.)
    entries[path] = asLocalBytes(realmEncoder.encode(value));
  }
  return asLocalBytes(zipSync(entries));
}

describe('convertSource', () => {
  it('round-trips an hcslides@1.0 source in passthrough mode', async () => {
    const source = await readSource(validBasicPath);
    const result = await convertSource(source);

    expect(result.manifest.schema).toBe('hcslides@1.0');
    expect(result.manifest.id).toBe('lite-fixture');
    expect(result.manifest.totalSlides).toBe(2);
    expect(result.report.sourceKind).toBe('hcslides@1.0');
    expect(result.report.mode).toBe('passthrough');
    expect(result.report.slides).toHaveLength(2);

    const unzipped = unzipSync(result.hcslides);
    const keys = Object.keys(unzipped);
    expect(keys).toContain('manifest.json');
    expect(keys).toContain('slides/01-cover.html');
    expect(keys).toContain('slides/02-details.html');
    expect(keys).toContain('shared/tokens.css');
  });

  it('emits a Markdown report when options.report is true', async () => {
    const source = await readSource(validBasicPath);
    const result = await convertSource(source, { report: true });

    expect(result.reportMarkdown).toBeDefined();
    expect(result.reportMarkdown).toContain('# SlidesDeck Converter Report');
    expect(result.reportMarkdown).toContain('Total slides**: 2');
    expect(result.reportMarkdown).toContain('Detected kind**: `hcslides@1.0`');
  });

  it('applies manifest overrides on top of the synthesized manifest', async () => {
    const source = await readSource(validBasicPath);
    const result = await convertSource(source, {
      manifestOverrides: { id: 'override-id', title: 'Override Title', version: '9.9.9' },
    });

    expect(result.manifest.id).toBe('override-id');
    expect(result.manifest.title).toBe('Override Title');
    expect(result.manifest.version).toBe('9.9.9');
  });

  it('wraps a plain-html source as a single-file slide (no compat.requires when no <script>)', async () => {
    const source = await readSource(plainHtmlPath);
    const result = await convertSource(source);

    expect(result.report.sourceKind).toBe('plain-html');
    expect(result.report.mode).toBe('single');
    expect(result.manifest.architecture).toBe('single-file-html');
    expect(result.manifest.provenance).toMatchObject({
      sourceKind: 'plain-html',
      conversionMode: 'single',
      sourceEntry: 'index.html',
      converter: { name: 'slides-deck-converter' },
    });
    expect(result.manifest.totalSlides).toBe(1);
    expect(result.manifest.title).toBe('Plain Single Page');
    expect(result.manifest.compat).toBeUndefined();

    const unzipped = unzipSync(result.hcslides);
    expect(Object.keys(unzipped)).toContain('manifest.json');
    // Single-HTML inputs are normalized to `index.html` by normalizeSource.
    expect(Object.keys(unzipped)).toContain('index.html');
    expect(result.manifest.slides[0].file).toBe('index.html');
  });

  it('populates compat.requires for a plain-html source that contains <script>', async () => {
    const bytes = realmEncoder.encode(
      `<!doctype html><html><head><title>Scripted</title></head><body>
        <h1>Hello</h1>
        <script>console.log("hi")</script>
      </body></html>`,
    );
    const result = await convertSource({ bytes: asLocalBytes(bytes), name: 'scripted.html' });

    expect(result.manifest.architecture).toBe('single-file-html');
    expect(result.manifest.compat?.requires).toEqual(
      expect.arrayContaining(['same-origin-storage', 'broadcast-channel']),
    );
    const note = result.report.warnings.find((w) => w.kind === 'note');
    expect(note).toBeDefined();
  });

  it('splits a webcomponent-deck into per-<deck-slide> static pages by default', async () => {
    const source = await readSource(webComponentPath);
    const result = await convertSource(source);

    expect(result.report.sourceKind).toBe('webcomponent-deck');
    expect(result.report.mode).toBe('split');
    expect(result.manifest.architecture).toBe('multi-file');
    expect(result.manifest.provenance).toMatchObject({
      sourceKind: 'webcomponent-deck',
      conversionMode: 'split',
      sourceEntry: 'index.html',
    });
    expect(result.manifest.totalSlides).toBe(2);
    expect(result.manifest.slides.map((s) => s.label)).toEqual(['WC 1', 'WC 2']);

    const unzipped = unzipSync(result.hcslides);
    const keys = Object.keys(unzipped);
    expect(keys).toContain('01-wc-1.html');
    expect(keys).toContain('02-wc-2.html');
    expect(keys).not.toContain('index.html');

    const first = new TextDecoder().decode(unzipped['01-wc-1.html']);
    expect(first).toContain('<deck-slide');
    expect(first).toContain('WC 1');
    expect(first).not.toContain('deck-stage.js');
  });

  it('round-trips a webcomponent-deck through loadDeck', async () => {
    const source = await readSource(webComponentPath);
    const result = await convertSource(source);

    const bytes = asLocalBytes(result.hcslides);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const file = new File([blob], 'converted-wc.hcslides', {
      type: 'application/zip',
      lastModified: Date.now(),
    });

    const loaded = await loadDeck(file);
    try {
      expect(loaded.manifest.totalSlides).toBe(2);
      expect(loaded.manifest.architecture).toBe('multi-file');
      expect(loaded.slideUrls).toHaveLength(2);
    } finally {
      loaded.revoke();
    }
  });

  it('splits a router-html deck by following window.DECK_MANIFEST entries', async () => {
    const source = await readSource(routerPath);
    const result = await convertSource(source);

    expect(result.report.sourceKind).toBe('router-html');
    expect(result.report.mode).toBe('split');
    expect(result.manifest.architecture).toBe('multi-file');
    expect(result.manifest.totalSlides).toBe(3);
    expect(result.manifest.slides.map((s) => s.label)).toEqual(['Cover', 'Quote', 'Finale']);
    expect(result.manifest.slides.map((s) => s.file)).toEqual([
      'slides/01-cover.html',
      'slides/02-quote.html',
      'slides/03-finale.html',
    ]);

    const unzipped = unzipSync(result.hcslides);
    expect(Object.keys(unzipped)).toContain('slides/01-cover.html');
    expect(Object.keys(unzipped)).toContain('shared/theme.css');
    // Loader page is no longer needed because slides[] points at the slide
    // files directly.
    expect(Object.keys(unzipped)).not.toContain('deck_index.html');

    const note = result.report.warnings.find(
      (w) => w.kind === 'note' && w.message.includes('parent-directory traversal'),
    );
    expect(note).toBeDefined();
  });

  it('round-trips a router-html deck through loadDeck', async () => {
    const source = await readSource(routerPath);
    const result = await convertSource(source);

    const bytes = asLocalBytes(result.hcslides);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const file = new File([blob], 'converted-router.hcslides', {
      type: 'application/zip',
      lastModified: Date.now(),
    });

    const loaded = await loadDeck(file);
    try {
      expect(loaded.manifest.totalSlides).toBe(3);
      expect(loaded.slideUrls).toHaveLength(3);
    } finally {
      loaded.revoke();
    }
  });

  it('falls back router-html → wrap when window.DECK_MANIFEST references nothing existing', async () => {
    const bytes = await buildLocalZip({
      'index.html': `<!doctype html><html><head><title>Empty router</title></head><body>
        <script>window.DECK_MANIFEST = [{ file: 'missing.html' }]</script>
      </body></html>`,
    });
    const result = await convertSource({ bytes, name: 'empty-router.zip' });

    expect(result.report.sourceKind).toBe('router-html');
    expect(result.report.mode).toBe('wrap');
    expect(result.manifest.architecture).toBe('single-file-html');
    expect(result.manifest.provenance).toMatchObject({
      sourceKind: 'router-html',
      conversionMode: 'wrap',
      sourceEntry: 'index.html',
    });
    expect(result.manifest.totalSlides).toBe(1);
    const fallback = result.report.warnings.find((w) => w.kind === 'fallback-mode');
    expect(fallback).toMatchObject({ from: 'split', to: 'wrap' });
    const missing = result.report.warnings.find(
      (w) => w.kind === 'router-missing-entry' && w.file === 'missing.html',
    );
    expect(missing).toBeDefined();
  });

  it('splits an inline-deck source into per-slide HTML pages', async () => {
    const source = await readSource(inlineDeckPath);
    const result = await convertSource(source);

    expect(result.report.sourceKind).toBe('inline-deck');
    expect(result.report.mode).toBe('split');
    expect(result.manifest.architecture).toBe('multi-file');
    expect(result.manifest.provenance).toMatchObject({
      sourceKind: 'inline-deck',
      conversionMode: 'split',
      sourceEntry: 'index.html',
    });
    expect(result.manifest.totalSlides).toBe(3);

    const labels = result.manifest.slides.map((s) => s.label);
    expect(labels).toEqual(['Cover', 'Two', 'Three']);

    const files = result.manifest.slides.map((s) => s.file);
    expect(files[0]).toBe('01-cover.html');
    expect(files[1]).toBe('02-two.html');
    expect(files[2]).toBe('03-three.html');

    const unzipped = unzipSync(result.hcslides);
    const keys = Object.keys(unzipped);
    expect(keys).toContain('manifest.json');
    expect(keys).toContain('01-cover.html');
    expect(keys).toContain('02-two.html');
    expect(keys).toContain('03-three.html');
    expect(keys).toContain('assets/theme.css');
    expect(keys).not.toContain('index.html');

    const decoder = new TextDecoder('utf-8');
    const firstPage = decoder.decode(unzipped['01-cover.html']);
    expect(firstPage).toContain('<section');
    expect(firstPage).toContain('Inline 1');
    expect(firstPage).toContain('assets/theme.css');
    expect(firstPage).not.toContain('runtime.js');
  });

  it('drops <script src="runtime.js"> in split mode and records a warning', async () => {
    const source = await readSource(inlineDeckPath);
    const result = await convertSource(source);
    const runtimeDropped = result.report.warnings.find((w) => w.kind === 'runtime-dropped');
    expect(runtimeDropped).toBeDefined();
  });

  it('produces .hcslides bytes that loadDeck accepts (inline-deck round-trip)', async () => {
    const source = await readSource(inlineDeckPath);
    const result = await convertSource(source);

    const bytes = asLocalBytes(result.hcslides);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const file = new File([blob], 'converted-inline.hcslides', {
      type: 'application/zip',
      lastModified: Date.now(),
    });

    const loaded = await loadDeck(file);
    try {
      expect(loaded.manifest.totalSlides).toBe(3);
      expect(loaded.manifest.architecture).toBe('multi-file');
      expect(loaded.slideUrls).toHaveLength(3);
      expect(loaded.slideUrls.every((url) => url.startsWith('blob:'))).toBe(true);
    } finally {
      loaded.revoke();
    }
  });

  it('wraps a webcomponent-deck when --mode wrap is requested explicitly', async () => {
    const source = await readSource(webComponentPath);
    const result = await convertSource(source, { mode: 'wrap' });

    expect(result.report.sourceKind).toBe('webcomponent-deck');
    expect(result.report.mode).toBe('wrap');
    expect(result.manifest.architecture).toBe('single-file-html');
    expect(result.manifest.provenance).toMatchObject({
      sourceKind: 'webcomponent-deck',
      conversionMode: 'wrap',
      sourceEntry: 'index.html',
    });
    expect(result.manifest.totalSlides).toBe(1);
    expect(result.manifest.compat?.requires).toEqual(
      expect.arrayContaining(['same-origin-storage', 'broadcast-channel', 'window-open']),
    );

    const unzipped = unzipSync(result.hcslides);
    expect(Object.keys(unzipped)).toContain('manifest.json');
    expect(result.report.warnings.some((w) => w.kind === 'note')).toBe(true);
  });


  it('refuses non-passthrough mode on hcslides@1.0 unless repackHcslides is set', async () => {
    const source = await readSource(validBasicPath);
    await expect(convertSource(source, { mode: 'split' })).rejects.toThrow(/passthrough/);
  });

  it('throws E_NO_ENTRY_FOUND on an empty zip', async () => {
    const bytes = await buildLocalZip({ 'readme.txt': 'no html here' });
    await expect(
      convertSource({ bytes, name: 'empty.zip' }),
    ).rejects.toMatchObject({ code: 'E_NO_ENTRY_FOUND' });
  });

  it('throws E_AMBIGUOUS_PACKAGE on multiple root HTMLs with no index.html', async () => {
    const bytes = await buildLocalZip({
      'a.html': '<h1>A</h1>',
      'b.html': '<h1>B</h1>',
    });
    let caughtCode: string | undefined;
    try {
      await convertSource({ bytes, name: 'multi.zip' });
    } catch (error) {
      if (error instanceof DeckLoadError) caughtCode = error.code;
    }
    expect(caughtCode).toBe('E_AMBIGUOUS_PACKAGE');
  });
});

describe('convertFolderSource', () => {
  function entriesFromText(map: Record<string, string>): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const [path, value] of Object.entries(map)) {
      out.set(path, asLocalBytes(realmEncoder.encode(value)));
    }
    return out;
  }

  it('packs a folder-shaped inline deck and the result loads through loadDeck', async () => {
    const entries = entriesFromText({
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <title>Folder Inline Deck</title>
  </head>
  <body>
    <div class="deck">
      <section class="slide" data-title="Hello"><h1>Hello</h1></section>
      <section class="slide" data-title="World"><h1>World</h1></section>
    </div>
    <script src="assets/runtime.js"></script>
  </body>
</html>`,
      'assets/runtime.js': 'console.log("noop");',
    });

    const result = await convertFolderSource(
      { entries, name: 'folder-inline-deck', lastModified: 0 },
      { report: true },
    );

    expect(result.report.sourceKind).toBe('inline-deck');
    expect(result.report.mode).toBe('split');
    expect(result.manifest.totalSlides).toBe(2);
    expect(result.manifest.slides[0].label).toBe('Hello');

    const buffer = result.hcslides.buffer.slice(
      result.hcslides.byteOffset,
      result.hcslides.byteOffset + result.hcslides.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const file = new File([blob], 'folder-inline-deck.hcslides', { type: 'application/zip' });
    const loaded = await loadDeck(file);
    try {
      expect(loaded.manifest.totalSlides).toBe(2);
      expect(loaded.manifest.title).toBe('Folder Inline Deck');
    } finally {
      loaded.revoke();
    }
  });

  it('drops dev-tree noise paths before sniffing (.git, node_modules, .DS_Store)', async () => {
    const entries = entriesFromText({
      'index.html': '<!doctype html><html><head><title>T</title></head><body><h1>T</h1></body></html>',
      '.git/HEAD': 'ref: refs/heads/main',
      'node_modules/foo/index.js': 'console.log(1);',
      '.DS_Store': '\x00\x00\x00',
    });

    const result = await convertFolderSource(
      { entries, name: 'noisy-folder', lastModified: 0 },
    );

    const unzipped = unzipSync(result.hcslides);
    const keys = Object.keys(unzipped);
    expect(keys).not.toContain('.git/HEAD');
    expect(keys).not.toContain('node_modules/foo/index.js');
    expect(keys).not.toContain('.DS_Store');
    expect(keys).toContain('manifest.json');
  });

  it('throws E_NO_ENTRY_FOUND when every input was filtered out', async () => {
    const entries = entriesFromText({
      '.DS_Store': '\x00',
      'node_modules/x/y.js': 'export {};',
    });
    await expect(
      convertFolderSource({ entries, name: 'all-skipped', lastModified: 0 }),
    ).rejects.toMatchObject({ code: 'E_NO_ENTRY_FOUND' });
  });
});
