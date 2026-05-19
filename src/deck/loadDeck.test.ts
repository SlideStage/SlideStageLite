// @vitest-environment node
//
// We need the node environment here because jsdom 29 + vitest 4 expose
// a cross-realm `Uint8Array` to test code: `strToU8`'s output is then
// no longer `instanceof Uint8Array` inside fflate's `zipSync`, and the
// zipper happily treats each byte as a sub-directory entry — every
// fixture comes back as `{ 'manifest.json/0/': ..., 'manifest.json/1/': ...}`
// and the deck loader rejects the file with E_NO_MANIFEST.
//
// `loadDeck` does not need a DOM in the SW-transport path. The fallback
// path uses `URL.createObjectURL`, which Node does not ship, so we add
// a tiny polyfill below.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { loadDeck } from './loadDeck';
import {
  DeckLoadError,
  type DeckAssetTransport,
  type StageAsset,
} from './types';

beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    let counter = 0;
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (
      _blob: Blob,
    ) => `blob:test://${++counter}`;
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
  }
});

const baseManifest = {
  schema: 'slidestage@1.0' as const,
  id: 'sw-fixture',
  version: '1.0.0',
  title: 'SW Fixture Deck',
  subtitle: null,
  author: null,
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  architecture: 'multi-file' as const,
  dimensions: { width: 1920, height: 1080 },
  totalSlides: 2,
  slides: [
    {
      index: 1,
      id: 'cover',
      label: 'Cover',
      file: 'slides/01-cover.html',
      thumbnail: 'thumbnails/01.png',
      notes: null,
    },
    {
      index: 2,
      id: 'two',
      label: 'Two',
      file: 'slides/02-two.html',
      thumbnail: null,
      notes: null,
    },
  ],
};

const themeCss = `:root { --accent: #1783ff; }
.slide { background: url("../assets/bg.png"); }
.slide h1 { color: var(--accent); }
@font-face {
  font-family: 'TestFont';
  src: url('../assets/test.woff2') format('woff2');
}
`;

// 1x1 transparent PNG bytes — kept as a template; `freshPng()` clones
// per fixture build so fflate's zipSync (which may reuse input
// buffers) does not poison subsequent test invocations.
const BG_PNG_TEMPLATE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function freshPng(): Uint8Array {
  return Uint8Array.from(BG_PNG_TEMPLATE);
}

function freshFontBytes(): Uint8Array {
  return new TextEncoder().encode('fake-woff2-payload');
}

const slideOneHtml = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../shared/theme.css" />
    <link rel="preconnect" href="https://fonts.gstatic.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans" />
  </head>
  <body>
    <div class="slide">
      <h1>Hello</h1>
      <img src="../assets/bg.png" alt="bg" />
      <script src="../assets/runtime.js"></script>
    </div>
  </body>
</html>`;

const slideTwoHtml = `<!doctype html>
<html>
  <body>
    <div class="slide">
      <h1>Second</h1>
    </div>
  </body>
</html>`;

const runtimeJs = `console.log('runtime');\n`;

function buildFixtureBytes(): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(`${JSON.stringify(baseManifest, null, 2)}\n`),
    'shared/theme.css': strToU8(themeCss),
    'assets/bg.png': freshPng(),
    'assets/test.woff2': freshFontBytes(),
    'assets/runtime.js': strToU8(runtimeJs),
    'slides/01-cover.html': strToU8(slideOneHtml),
    'slides/02-two.html': strToU8(slideTwoHtml),
    'thumbnails/01.png': freshPng(),
  });
}

function fixtureFile(name = 'sw-fixture.stage'): File {
  const built = buildFixtureBytes();
  // TS's `File`/`Blob` typings prefer `ArrayBuffer`-not-`ArrayBufferLike`,
  // and fflate types its return as `Uint8Array<ArrayBufferLike>`. A copy
  // into a fresh ArrayBuffer satisfies the constructor without losing
  // any bytes.
  const copy = new Uint8Array(new ArrayBuffer(built.byteLength));
  copy.set(built);
  return new File([copy], name, { type: 'application/zip' });
}

interface RecordingTransport extends DeckAssetTransport {
  publishedFor(deckId: string): StageAsset[];
  unpublishedIds(): string[];
}

function makeRecordingTransport(opts: { failPublish?: boolean } = {}): RecordingTransport {
  const published = new Map<string, StageAsset[]>();
  const unpublished: string[] = [];
  const transport: RecordingTransport = {
    virtualUrlFor: (deckId, path) => `/__stage/${deckId}/${path}`,
    publishDeck: async (deckId, assets) => {
      if (opts.failPublish) {
        throw new Error('boom');
      }
      published.set(
        deckId,
        // Clone bytes so we can inspect them after the loader (which may
        // detach the buffers when integrated with the real Service
        // Worker transport).
        assets.map((asset) => ({
          ...asset,
          bytes: new Uint8Array(asset.bytes),
        })),
      );
    },
    unpublishDeck: async (deckId) => {
      unpublished.push(deckId);
    },
    publishedFor: (deckId) => published.get(deckId) ?? [],
    unpublishedIds: () => unpublished,
  };
  return transport;
}

describe('loadDeck with a Service Worker transport', () => {
  it('publishes every non-manifest asset and exposes virtual slide URLs', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(fixtureFile(), { transport });

    expect(deck.deckId).toMatch(/^[a-f0-9]{16}$/);
    // With a transport in place, the loader emits virtual URLs in
    // `slideUrls`. The viewer is what ultimately decides whether to
    // use them — sandboxed iframes (`allow-scripts` baseline) get an
    // opaque origin that Chrome bypasses for SW interception, so the
    // viewer renders those via `srcdoc` regardless. `prefersSrcdoc`
    // here just means "the host has no transport at all"; it stays
    // false when a transport is supplied.
    expect(deck.prefersSrcdoc).toBe(false);
    expect(deck.slideUrls).toEqual([
      `/__stage/${deck.deckId}/slides/01-cover.html`,
      `/__stage/${deck.deckId}/slides/02-two.html`,
    ]);
    expect(deck.thumbnailUrls).toEqual([
      `/__stage/${deck.deckId}/thumbnails/01.png`,
      null,
    ]);

    const published = transport.publishedFor(deck.deckId);
    const paths = published.map((asset) => asset.path).sort();
    expect(paths).toEqual([
      'assets/bg.png',
      'assets/runtime.js',
      'assets/test.woff2',
      'shared/theme.css',
      'slides/01-cover.html',
      'slides/02-two.html',
      'thumbnails/01.png',
    ]);
    expect(paths).not.toContain('manifest.json');
  });

  it('publishes slide HTML rewritten to point at virtual URLs', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(fixtureFile(), { transport });

    const published = transport.publishedFor(deck.deckId);
    const slideOne = published.find((asset) => asset.path === 'slides/01-cover.html');
    expect(slideOne, 'slide html should be published').toBeDefined();
    const rewritten = new TextDecoder().decode(slideOne!.bytes);

    // No blob: URLs and no leftover data: URLs should appear in slide
    // HTML when a transport is in use — every asset reference must be
    // a same-origin virtual URL.
    expect(rewritten).not.toMatch(/blob:/);
    expect(rewritten).not.toMatch(/data:/);

    // The inlined <style> from `<link rel="stylesheet">` keeps theme
    // background and @font-face references; they should all point at
    // the virtual URL namespace.
    expect(rewritten).toContain(`/__stage/${deck.deckId}/assets/bg.png`);
    expect(rewritten).toContain(`/__stage/${deck.deckId}/assets/test.woff2`);
    expect(rewritten).toContain(`/__stage/${deck.deckId}/assets/runtime.js`);
  });

  it('keeps a self-contained data-URL flavor available for srcdoc fallback', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(fixtureFile(), { transport });

    expect(deck.slideHtml).toHaveLength(2);
    const fallback = deck.slideHtml[0];
    expect(fallback).toContain('data:image/png;base64');
    expect(fallback).toContain('data:font/woff2;base64');
    expect(fallback).not.toMatch(/blob:/);
    expect(fallback).not.toMatch(/__stage\//);
  });

  // Regression: an earlier version of the loader fed every srcdoc
  // through `stripExternalLinkReferences`, which silently dropped
  // Google Fonts and CDN themes on the Web build. The default
  // behaviour must keep the link tag (deferred to media="print" so
  // first paint is not blocked) so CDN typography still loads.
  it('keeps external stylesheet links (deferred) in the srcdoc flavour by default', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(fixtureFile(), { transport });
    const srcdoc = deck.slideHtml[0];
    expect(srcdoc).toContain('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans');
    expect(srcdoc).toContain('media="print"');
    expect(srcdoc).toContain("this.media='all'");
  });

  it('strips external stylesheet links when stripExternalLinks is enabled (Tauri)', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(fixtureFile(), {
      transport,
      stripExternalLinks: true,
    });
    const srcdoc = deck.slideHtml[0];
    expect(srcdoc).not.toContain('fonts.googleapis.com');
    expect(srcdoc).not.toContain('fonts.gstatic.com');
    // The internal CSS path still survives — the strip only takes out
    // `<link>` tags that point at non-data: external URLs.
    expect(srcdoc).toContain('data:image/png;base64');
  });

  it('falls back to blob:URL + data:URL inlining when no transport is supplied', async () => {
    const deck = await loadDeck(fixtureFile());
    expect(deck.prefersSrcdoc).toBe(true);
    expect(deck.slideUrls.every((url) => url.startsWith('blob:'))).toBe(true);
    expect(deck.slideHtml[0]).toContain('data:image/png;base64');
    expect(deck.slideHtml[0]).not.toMatch(/blob:/);
  });

  it('derives deckId deterministically from the fingerprint', async () => {
    const transport = makeRecordingTransport();
    const first = await loadDeck(fixtureFile(), { transport });
    const second = await loadDeck(fixtureFile(), { transport });
    expect(first.deckId).toBe(second.deckId);
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('surfaces publish failures as E_TRANSPORT_PUBLISH_FAILED', async () => {
    const transport = makeRecordingTransport({ failPublish: true });
    await expect(loadDeck(fixtureFile(), { transport })).rejects.toMatchObject({
      name: 'DeckLoadError',
      code: 'E_TRANSPORT_PUBLISH_FAILED',
    });
  });

  it('calls transport.unpublishDeck during revoke', async () => {
    const transport = makeRecordingTransport();
    const unpublishSpy = vi.spyOn(transport, 'unpublishDeck');
    const deck = await loadDeck(fixtureFile(), { transport });
    deck.revoke();
    // unpublishDeck is fire-and-forget; we need to flush microtasks.
    await Promise.resolve();
    expect(unpublishSpy).toHaveBeenCalledWith(deck.deckId);
  });

  it('rejects garbage zips before contacting the transport', async () => {
    const transport = makeRecordingTransport();
    const publishSpy = vi.spyOn(transport, 'publishDeck');
    const garbage = new File([new Uint8Array([1, 2, 3, 4])], 'broken.stage');
    await expect(loadDeck(garbage, { transport })).rejects.toBeInstanceOf(DeckLoadError);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

// Regression: mirrored decks store the original external fonts under
// `assets/_mirror/font/<hash>.<ext>` and rewrite the CSS @font-face
// `url(...)` to point at sibling-relative paths. The loader must
// inline the mirrored CSS body, walk those sibling url() references,
// and emit `data:font/...;base64,...` URLs so the srcdoc iframe can
// actually paint with the right typeface even when the
// network/firewall blocks fonts.gstatic.com outright.
describe('loadDeck with mirrored assets', () => {
  const mirroredCss = `@font-face {
  font-family: 'PJSans';
  font-style: normal;
  font-weight: 400;
  src: local('Plus Jakarta Sans'),
       url(../font/abcdef0123456789.woff2) format('woff2');
}
@font-face {
  font-family: 'PJSerif';
  font-weight: 400;
  src: url('../font/aabbccddeeff0011.ttf') format('truetype');
}
.headline { font-family: 'PJSans', system-ui, sans-serif; }
.body { font-family: 'PJSerif', Georgia, serif; }
`;

  const mirroredSlideHtml = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../assets/_mirror/css/cafebabe12345678.css" />
  </head>
  <body>
    <h1 class="headline">Hello fonts</h1>
    <p class="body">Body copy here.</p>
  </body>
</html>`;

  const mirroredManifest = {
    ...baseManifest,
    id: 'mirror-roundtrip',
    title: 'Mirror Roundtrip Deck',
    totalSlides: 1,
    slides: [
      {
        index: 1,
        id: 'mirror',
        label: 'Mirror',
        file: 'slides/01-mirror.html',
        thumbnail: null,
        notes: null,
      },
    ],
    offline: {
      ready: true,
      mirroredAt: '2026-05-19T00:00:00.000Z',
      mirrorTool: { name: 'slidestage-mirror', version: '0.1.0' },
      policy: {
        includeScripts: false,
        includeIframes: false,
        maxAssetBytes: 50 * 1024 * 1024,
        maxTotalBytes: 500 * 1024 * 1024,
      },
      mirroredAssets: [
        {
          originalUrl: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans',
          path: 'assets/_mirror/css/cafebabe12345678.css',
          contentHash: 'sha256-cafe',
          contentType: 'text/css',
          bytes: 0,
          fetchedAt: '2026-05-19T00:00:00.000Z',
          referencedBy: [1],
        },
        {
          originalUrl: 'https://fonts.gstatic.com/s/plusjakartasans/v8/regular.woff2',
          path: 'assets/_mirror/font/abcdef0123456789.woff2',
          contentHash: 'sha256-woff2',
          contentType: 'font/woff2',
          bytes: 0,
          fetchedAt: '2026-05-19T00:00:00.000Z',
          referencedBy: [1],
        },
        {
          originalUrl: 'https://fonts.gstatic.com/s/plusjakartaserif/v1/regular.ttf',
          path: 'assets/_mirror/font/aabbccddeeff0011.ttf',
          contentHash: 'sha256-ttf',
          contentType: 'font/ttf',
          bytes: 0,
          fetchedAt: '2026-05-19T00:00:00.000Z',
          referencedBy: [1],
        },
      ],
      skippedUrls: [],
    },
  };

  function buildMirroredFixture(): File {
    const built = zipSync({
      'manifest.json': strToU8(`${JSON.stringify(mirroredManifest, null, 2)}\n`),
      'slides/01-mirror.html': strToU8(mirroredSlideHtml),
      'assets/_mirror/css/cafebabe12345678.css': strToU8(mirroredCss),
      'assets/_mirror/font/abcdef0123456789.woff2': new TextEncoder().encode(
        'fake-woff2-payload',
      ),
      'assets/_mirror/font/aabbccddeeff0011.ttf': new TextEncoder().encode(
        'fake-ttf-payload',
      ),
    });
    const copy = new Uint8Array(new ArrayBuffer(built.byteLength));
    copy.set(built);
    return new File([copy], 'mirror-roundtrip.stage', { type: 'application/zip' });
  }

  it('inlines mirrored CSS and rewrites @font-face url() to data:font URLs', async () => {
    const deck = await loadDeck(buildMirroredFixture());
    expect(deck.slideHtml).toHaveLength(1);

    const srcdoc = deck.slideHtml[0];

    // The external <link rel="stylesheet"> for the mirrored CSS file
    // must have been replaced by an inline <style> block.
    expect(srcdoc).toContain(
      '<style data-slidestage-inline-css="assets/_mirror/css/cafebabe12345678.css">',
    );

    // The .woff2 reference must resolve to a data: URL of the
    // canonical font/woff2 MIME so the @font-face actually loads
    // inside the srcdoc opaque-origin iframe.
    expect(srcdoc).toContain('data:font/woff2;base64,');

    // The .ttf reference must also be inlined with a font/ttf MIME.
    // Both fonts must be reachable from inside the inlined <style>.
    expect(srcdoc).toMatch(/url\("data:font\/ttf;base64,[^"]+"\)/);

    // No leftover sibling-relative font URL strings should escape
    // into the rendered HTML — if they do, the iframe would try to
    // fetch them as relative URLs from the srcdoc opaque origin and
    // fail.
    expect(srcdoc).not.toContain('../font/abcdef');
    expect(srcdoc).not.toContain('../font/aabbcc');
  });

  it('keeps the original mirrored CSS link out of the final srcdoc', async () => {
    const deck = await loadDeck(buildMirroredFixture());
    const srcdoc = deck.slideHtml[0];
    // The original <link rel="stylesheet" href="../assets/_mirror/css/..."/>
    // is replaced; no naked href to a mirrored CSS should remain.
    expect(srcdoc).not.toContain(
      'href="../assets/_mirror/css/cafebabe12345678.css"',
    );
  });
});

// Regression: real-world mirrored decks (e.g. the user's `hier_mas
// Research Deck — Week 7`) chain a shared design-token CSS that
// `@import`s the mirrored CSS file, which in turn declares dozens of
// `@font-face`s with sibling-relative `url("../font/<hash>.ttf")`. The
// loader must splice the @import body into the parent CSS so those
// font URLs resolve to data: URLs — if they stay as `@import url(data:
// text/css;base64,…)` instead, the data: URL has no base and every
// `../font/...ttf` 404s.
describe('loadDeck with chained @import mirrored fonts (real-world structure)', () => {
  const tokensCss = `:root {
  --serif: 'Newsreader', Georgia, serif;
  --sans: 'Inter', system-ui, sans-serif;
}
@import url("../assets/_mirror/css/8de586a6c979fced.css");
body { font-family: var(--sans); }
`;

  const mirroredFontsCss = `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("../font/d0f4bc7faca46837.ttf") format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("../font/b37284b5701b6b16.ttf") format('truetype');
}
@font-face {
  font-family: 'Newsreader';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url("../font/44ce4a84f20d60f2.ttf") format('truetype');
}
`;

  const slideHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>hier_mas · Cover</title>
  <link rel="stylesheet" href="../shared/tokens.css">
</head>
<body>
  <h1>Hello fonts</h1>
</body>
</html>`;

  const realWorldManifest = {
    ...baseManifest,
    id: 'hier-mas-fixture',
    title: 'hier_mas style deck',
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
  };

  function buildRealWorldFixture(): File {
    const built = zipSync({
      'manifest.json': strToU8(`${JSON.stringify(realWorldManifest, null, 2)}\n`),
      'slides/01-cover.html': strToU8(slideHtml),
      'shared/tokens.css': strToU8(tokensCss),
      'assets/_mirror/css/8de586a6c979fced.css': strToU8(mirroredFontsCss),
      'assets/_mirror/font/d0f4bc7faca46837.ttf': new TextEncoder().encode(
        'inter-regular-payload',
      ),
      'assets/_mirror/font/b37284b5701b6b16.ttf': new TextEncoder().encode(
        'inter-bold-payload',
      ),
      'assets/_mirror/font/44ce4a84f20d60f2.ttf': new TextEncoder().encode(
        'newsreader-italic-payload',
      ),
    });
    const copy = new Uint8Array(new ArrayBuffer(built.byteLength));
    copy.set(built);
    return new File([copy], 'hier-mas-style.stage', { type: 'application/zip' });
  }

  it('splices mirrored CSS into tokens.css and inlines every font as a data:font URL', async () => {
    const deck = await loadDeck(buildRealWorldFixture());
    const srcdoc = deck.slideHtml[0];

    // tokens.css must be inlined into the slide as a <style> block.
    expect(srcdoc).toContain('<style data-slidestage-inline-css="shared/tokens.css">');

    // The @import in tokens.css must NOT survive as a literal
    // @import — it should be replaced with the mirrored CSS body.
    expect(srcdoc).not.toContain('@import url(');
    expect(srcdoc).not.toContain('@import "');
    expect(srcdoc).toContain('slidestage:inlined @import assets/_mirror/css/8de586a6c979fced.css');

    // Each of the three font files must be inlined as a data:font/ttf
    // URL inside the merged CSS body.
    const dataUrlMatches = srcdoc.match(/url\("data:font\/ttf;base64,[^"]+"\)/g) ?? [];
    expect(dataUrlMatches.length).toBeGreaterThanOrEqual(3);

    // The original sibling-relative font URLs must be gone — if any
    // survived, the iframe would 404 because the srcdoc opaque-origin
    // iframe can't resolve them.
    expect(srcdoc).not.toContain('../font/d0f4bc7faca46837.ttf');
    expect(srcdoc).not.toContain('../font/b37284b5701b6b16.ttf');
    expect(srcdoc).not.toContain('../font/44ce4a84f20d60f2.ttf');
  });
});

// Regression: 146 MB CJK-font decks crashed the renderer because the
// loader's `createDataUrls()` base64-encoded every asset upfront and
// then `createSlideContents()` inlined the encoded blob into each
// slide's srcdoc — V8 string heap pressure tripped a SIGTERM (Chrome
// exit code 5). The fix is `inlineMode: 'auto'`: above
// `inlineBudgetBytes` the loader skips the data: URL pass and the
// deck MUST be rendered via the transport's virtual URLs. The viewer
// guards this with a `deck.inlinedHtmlAvailable` check.
describe('loadDeck inlineMode budget', () => {
  // The week8 OOM trace blamed a few 14 MB Noto Sans CJK TTFs. Build a
  // small synthetic stand-in: one fake "font" entry whose byte length
  // can be dialled up or down per test.
  function buildSizedFixture(extraAssetBytes: number, name: string): File {
    const filler = new Uint8Array(extraAssetBytes);
    // Vary the bytes so the asset isn't a sparse zero-page that some
    // zip implementations might fold. Real fonts aren't compressible
    // either.
    for (let i = 0; i < extraAssetBytes; i += 1) {
      filler[i] = i & 0xff;
    }
    const built = zipSync({
      'manifest.json': strToU8(`${JSON.stringify(baseManifest, null, 2)}\n`),
      'shared/theme.css': strToU8(themeCss),
      'assets/bg.png': freshPng(),
      'assets/test.woff2': freshFontBytes(),
      'assets/runtime.js': strToU8(runtimeJs),
      'assets/giant.ttf': filler,
      'slides/01-cover.html': strToU8(slideOneHtml),
      'slides/02-two.html': strToU8(slideTwoHtml),
      'thumbnails/01.png': freshPng(),
    });
    const copy = new Uint8Array(new ArrayBuffer(built.byteLength));
    copy.set(built);
    return new File([copy], name, { type: 'application/zip' });
  }

  it('inlineMode "always" (default) still inlines regardless of size', async () => {
    const transport = makeRecordingTransport();
    // 1 MB of "font", well under the default budget.
    const deck = await loadDeck(buildSizedFixture(1_000_000, 'small.stage'), {
      transport,
      // explicit to document intent
      inlineMode: 'always',
    });

    expect(deck.inlinedHtmlAvailable).toBe(true);
    expect(deck.totalAssetBytes).toBeGreaterThan(1_000_000);
    expect(deck.slideHtml[0]).toContain('data:image/png;base64');
    // No placeholder.
    expect(deck.slideHtml[0]).not.toContain('srcdoc disabled');
  });

  it('inlineMode "auto" + small deck behaves like "always"', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(buildSizedFixture(1_000_000, 'small-auto.stage'), {
      transport,
      inlineMode: 'auto',
      inlineBudgetBytes: 16 * 1024 * 1024,
    });

    expect(deck.inlinedHtmlAvailable).toBe(true);
    expect(deck.slideHtml[0]).toContain('data:image/png;base64');
  });

  it('inlineMode "auto" + oversized deck skips inline and exposes the SW path only', async () => {
    const transport = makeRecordingTransport();
    // 25 MB filler, comfortably above an 8 MB test budget.
    const deck = await loadDeck(buildSizedFixture(25 * 1024 * 1024, 'big-auto.stage'), {
      transport,
      inlineMode: 'auto',
      inlineBudgetBytes: 8 * 1024 * 1024,
    });

    expect(deck.inlinedHtmlAvailable).toBe(false);
    expect(deck.totalAssetBytes).toBeGreaterThan(8 * 1024 * 1024);
    // prefersSrcdoc must be false too — viewer code reads this to
    // decide between src and srcdoc; insisting on srcdoc for a
    // placeholder body would paint an empty slide.
    expect(deck.prefersSrcdoc).toBe(false);
    // slideHtml entries are the placeholder, NOT the inlined HTML.
    for (const html of deck.slideHtml) {
      expect(html).toContain('srcdoc disabled');
      expect(html).not.toContain('data:image/png');
      expect(html).not.toContain('data:font/');
    }
    // The transport still got every asset (the deck is renderable via
    // src={virtualUrl}, just not via srcdoc).
    const paths = transport
      .publishedFor(deck.deckId)
      .map((a) => a.path)
      .sort();
    expect(paths).toContain('assets/giant.ttf');
    expect(paths).toContain('slides/01-cover.html');

    // The published slide HTML must still be the rewritten flavour
    // (virtual URLs, not the placeholder).
    const slideOne = transport
      .publishedFor(deck.deckId)
      .find((asset) => asset.path === 'slides/01-cover.html');
    expect(slideOne).toBeDefined();
    const rewritten = new TextDecoder().decode(slideOne!.bytes);
    expect(rewritten).toContain(`/__stage/${deck.deckId}/`);
    expect(rewritten).not.toContain('srcdoc disabled');
  });

  it('inlineMode "auto" + oversized + NO transport throws E_TOO_LARGE_FOR_INLINE', async () => {
    await expect(
      loadDeck(buildSizedFixture(25 * 1024 * 1024, 'big-no-transport.stage'), {
        inlineMode: 'auto',
        inlineBudgetBytes: 8 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      name: 'DeckLoadError',
      code: 'E_TOO_LARGE_FOR_INLINE',
    });
  });

  it('inlineMode "never" skips inline regardless of size when a transport is supplied', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(buildSizedFixture(1_000, 'tiny-never.stage'), {
      transport,
      inlineMode: 'never',
    });
    expect(deck.inlinedHtmlAvailable).toBe(false);
    expect(deck.slideHtml.every((h) => h.includes('srcdoc disabled'))).toBe(true);
  });

  it('inlineMode "never" with no transport throws E_TOO_LARGE_FOR_INLINE too', async () => {
    await expect(
      loadDeck(buildSizedFixture(1_000, 'tiny-never-no-transport.stage'), {
        inlineMode: 'never',
      }),
    ).rejects.toMatchObject({
      name: 'DeckLoadError',
      code: 'E_TOO_LARGE_FOR_INLINE',
    });
  });

  it('totalAssetBytes excludes manifest.json from the size accounting', async () => {
    const transport = makeRecordingTransport();
    const deck = await loadDeck(buildSizedFixture(100_000, 'accounting.stage'), {
      transport,
    });
    // sanity: total > filler + smallest other entries but well under
    // the default 16 MB budget (we use inlineMode='always' default
    // here, so it goes through the inline path either way).
    expect(deck.totalAssetBytes).toBeGreaterThan(100_000);
    expect(deck.totalAssetBytes).toBeLessThan(16 * 1024 * 1024);
  });
});
