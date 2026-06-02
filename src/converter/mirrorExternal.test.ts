import { describe, expect, it } from 'vitest';
import type { Manifest } from '@slidestage/core/deck/types';
import {
  createNetworkFetcher,
  extractExternalRefsFromCss,
  extractExternalRefsFromHtml,
  mirrorExternalAssets,
  type MirrorFetchResult,
  type MirrorFetcher,
} from '@slidestage/core/converter/mirrorExternal';
import { bytesFromString } from '@slidestage/core/converter/pack';

function manifestForSlides(
  slides: Array<{ index: number; id: string; file: string }>,
): Manifest {
  return {
    schema: 'slidestage@1.0',
    id: 'mirror-test',
    version: '1.0.0',
    title: 'Mirror Test',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: slides.length,
    slides: slides.map((s) => ({
      index: s.index,
      id: s.id,
      label: s.id,
      file: s.file,
      thumbnail: null,
      notes: null,
    })),
  };
}

function recordingFetcher(
  responses: Record<string, MirrorFetchResult>,
): { fetcher: MirrorFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: MirrorFetcher = async (url) => {
    calls.push(url);
    const next = responses[url];
    if (!next) {
      return { ok: false, reason: 'unreachable', detail: 'not configured' };
    }
    return next;
  };
  return { fetcher, calls };
}

describe('extractExternalRefsFromHtml', () => {
  it('captures img, link[stylesheet], srcset and link[preload as=font] hrefs', () => {
    const html = `
      <!doctype html>
      <html>
      <head>
        <link rel="stylesheet" href="https://cdn.example.com/style.css" />
        <link rel="preload" as="font" href="https://cdn.example.com/font.woff2" crossorigin />
        <link rel="preconnect" href="https://noise.example.com" />
      </head>
      <body>
        <img src="https://images.example.com/hero.png" alt="hero" />
        <img srcset="https://images.example.com/2x.png 2x, https://images.example.com/3x.png 3x" />
        <video poster="https://images.example.com/poster.jpg"></video>
      </body>
      </html>
    `;
    const refs = extractExternalRefsFromHtml(html, {});
    const urls = new Set(refs.map((r) => r.url));
    expect(urls.has('https://cdn.example.com/style.css')).toBe(true);
    expect(urls.has('https://cdn.example.com/font.woff2')).toBe(true);
    expect(urls.has('https://images.example.com/hero.png')).toBe(true);
    expect(urls.has('https://images.example.com/2x.png')).toBe(true);
    expect(urls.has('https://images.example.com/3x.png')).toBe(true);
    expect(urls.has('https://images.example.com/poster.jpg')).toBe(true);
    // preconnect is metadata only, not mirrored.
    expect(urls.has('https://noise.example.com')).toBe(false);
  });

  it('skips <script src> and <iframe src> by default and opts in only on policy', () => {
    const html = `
      <script src="https://cdn.example.com/script.js"></script>
      <iframe src="https://example.com/embed"></iframe>
    `;
    const defaults = extractExternalRefsFromHtml(html, {});
    expect(defaults.map((r) => r.url)).not.toContain('https://cdn.example.com/script.js');
    expect(defaults.map((r) => r.url)).not.toContain('https://example.com/embed');

    const elevated = extractExternalRefsFromHtml(html, {
      includeScripts: true,
      includeIframes: true,
    });
    expect(elevated.map((r) => r.url)).toContain('https://cdn.example.com/script.js');
    expect(elevated.map((r) => r.url)).toContain('https://example.com/embed');
  });

  it('absolutizes protocol-relative URLs (//cdn/...) to https://', () => {
    const html = '<link rel="stylesheet" href="//cdn.example.com/style.css" />';
    const refs = extractExternalRefsFromHtml(html, {});
    expect(refs.some((r) => r.url === 'https://cdn.example.com/style.css')).toBe(true);
  });
});

describe('extractExternalRefsFromCss', () => {
  it('captures both url() and @import "..." forms', () => {
    const css = `
      @import "https://cdn.example.com/reset.css";
      @import url('https://cdn.example.com/typo.css');
      .a { background: url("https://images.example.com/bg.png"); }
    `;
    const refs = extractExternalRefsFromCss(css);
    const urls = new Set(refs.map((r) => r.url));
    expect(urls.has('https://cdn.example.com/reset.css')).toBe(true);
    // url(...) form also captured by cssUrlPattern
    expect(urls.has('https://cdn.example.com/typo.css')).toBe(true);
    expect(urls.has('https://images.example.com/bg.png')).toBe(true);
  });
});

describe('mirrorExternalAssets', () => {
  const fixedNow = () => new Date('2024-04-29T11:54:00.000Z');

  it('mirrors a simple image, rewrites the slide HTML, and reports offline.ready', async () => {
    const html = '<img src="https://images.example.com/hero.png" />';
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { fetcher } = recordingFetcher({
      'https://images.example.com/hero.png': {
        ok: true,
        bytes: pngBytes,
        contentType: 'image/png',
      },
    });

    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow },
    );

    expect(result.offline.ready).toBe(true);
    expect(result.offline.mirroredAssets).toHaveLength(1);
    const mirrored = result.offline.mirroredAssets[0];
    expect(mirrored.originalUrl).toBe('https://images.example.com/hero.png');
    expect(mirrored.path.startsWith('assets/_mirror/img/')).toBe(true);
    expect(mirrored.path.endsWith('.png')).toBe(true);
    expect(mirrored.contentHash.startsWith('sha256-')).toBe(true);
    expect(mirrored.bytes).toBe(pngBytes.byteLength);
    expect(mirrored.referencedBy).toEqual([1]);

    // Slide HTML must have been rewritten to point at the local asset.
    const rewritten = new TextDecoder().decode(result.entries.get('slides/01-cover.html')!);
    expect(rewritten).not.toContain('https://images.example.com/hero.png');
    expect(rewritten).toContain(`src="../${mirrored.path}"`);

    // Mirrored bytes must exist in entries.
    expect(result.entries.has(mirrored.path)).toBe(true);
    expect(result.entries.get(mirrored.path)).toEqual(pngBytes);
  });

  it('does not mutate the input map (returns a defensive copy)', async () => {
    const html = '<img src="https://images.example.com/hero.png" />';
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const snapshotBefore = new TextDecoder().decode(entries.get('slides/01-cover.html')!);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher } = recordingFetcher({
      'https://images.example.com/hero.png': {
        ok: true,
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
      },
    });
    await mirrorExternalAssets({ entries, manifest }, { fetcher, now: fixedNow });
    const snapshotAfter = new TextDecoder().decode(entries.get('slides/01-cover.html')!);
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it('falls back to offline.ready=false when a URL is unreachable', async () => {
    const html = `
      <img src="https://images.example.com/ok.png" />
      <img src="https://broken.example.com/missing.png" />
    `;
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher } = recordingFetcher({
      'https://images.example.com/ok.png': {
        ok: true,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
      },
      'https://broken.example.com/missing.png': {
        ok: false,
        reason: 'unreachable',
        detail: 'HTTP 404',
      },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow },
    );
    expect(result.offline.ready).toBe(false);
    expect(result.offline.mirroredAssets).toHaveLength(1);
    expect(result.offline.skippedUrls).toHaveLength(1);
    expect(result.offline.skippedUrls[0].reason).toBe('unreachable');
    // The reachable URL must still have been rewritten in the slide HTML.
    const rewritten = new TextDecoder().decode(result.entries.get('slides/01-cover.html')!);
    expect(rewritten).not.toContain('https://images.example.com/ok.png');
    // The broken URL stays as-is.
    expect(rewritten).toContain('https://broken.example.com/missing.png');
  });

  it('honours allowedHosts / blockedHosts in the policy', async () => {
    const html = `
      <img src="https://allowed.example.com/a.png" />
      <img src="https://denied.example.com/b.png" />
    `;
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher, calls } = recordingFetcher({
      'https://allowed.example.com/a.png': {
        ok: true,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
      },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      {
        fetcher,
        now: fixedNow,
        policy: { blockedHosts: ['denied.example.com'] },
      },
    );
    // Blocked URL must NOT be fetched.
    expect(calls).toEqual(['https://allowed.example.com/a.png']);
    expect(result.offline.skippedUrls.some((s) => s.reason === 'blocked-by-policy')).toBe(true);
  });

  it('blocks private / loopback / link-local / metadata / internal hosts by default (SSRF guard)', async () => {
    const html = `
      <img src="http://127.0.0.1:8080/a.png" />
      <img src="http://169.254.169.254/latest/meta-data/" />
      <img src="http://192.168.1.10/b.png" />
      <img src="http://10.0.0.5/c.png" />
      <img src="http://internal-svc.local/d.png" />
      <img src="http://db.internal/e.png" />
      <img src="https://images.example.com/ok.png" />
    `;
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher, calls } = recordingFetcher({
      'https://images.example.com/ok.png': {
        ok: true,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
      },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow },
    );
    // Only the public URL ever reaches the network.
    expect(calls).toEqual(['https://images.example.com/ok.png']);
    const blocked = result.offline.skippedUrls
      .filter((s) => s.reason === 'blocked-by-policy')
      .map((s) => s.url)
      .sort();
    expect(blocked).toEqual(
      [
        'http://127.0.0.1:8080/a.png',
        'http://169.254.169.254/latest/meta-data/',
        'http://192.168.1.10/b.png',
        'http://10.0.0.5/c.png',
        'http://internal-svc.local/d.png',
        'http://db.internal/e.png',
      ].sort(),
    );
  });

  it('mirrors private hosts only when allowPrivateNetwork is explicitly enabled', async () => {
    const html = '<img src="http://127.0.0.1:8080/a.png" />';
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher, calls } = recordingFetcher({
      'http://127.0.0.1:8080/a.png': {
        ok: true,
        bytes: new Uint8Array([7]),
        contentType: 'image/png',
      },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow, policy: { allowPrivateNetwork: true } },
    );
    expect(calls).toEqual(['http://127.0.0.1:8080/a.png']);
    expect(result.offline.mirroredAssets).toHaveLength(1);
    expect(result.offline.policy?.allowPrivateNetwork).toBe(true);
  });

  it('skips assets larger than maxAssetBytes', async () => {
    const big = new Uint8Array(2 * 1024 * 1024); // 2 MiB
    const html = '<img src="https://big.example.com/huge.png" />';
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher } = recordingFetcher({
      'https://big.example.com/huge.png': {
        ok: true,
        bytes: big,
        contentType: 'image/png',
      },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow, policy: { maxAssetBytes: 1024 * 1024 } },
    );
    expect(result.offline.mirroredAssets).toHaveLength(0);
    expect(result.offline.skippedUrls[0].reason).toBe('too-large');
  });

  it('walks mirrored CSS bodies to mirror child url()/@import too', async () => {
    const html = '<link rel="stylesheet" href="https://cdn.example.com/main.css" />';
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const cssBody = `
      @font-face {
        font-family: 'X';
        src: url('https://cdn.example.com/font.woff2') format('woff2');
      }
    `;
    const responses: Record<string, MirrorFetchResult> = {
      'https://cdn.example.com/main.css': {
        ok: true,
        bytes: bytesFromString(cssBody),
        contentType: 'text/css',
      },
      'https://cdn.example.com/font.woff2': {
        ok: true,
        bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
        contentType: 'font/woff2',
      },
    };
    const { fetcher } = recordingFetcher(responses);
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow },
    );

    expect(result.offline.ready).toBe(true);
    expect(result.offline.mirroredAssets.length).toBe(2);
    const cssAsset = result.offline.mirroredAssets.find(
      (a) => a.originalUrl === 'https://cdn.example.com/main.css',
    )!;
    const fontAsset = result.offline.mirroredAssets.find(
      (a) => a.originalUrl === 'https://cdn.example.com/font.woff2',
    )!;
    expect(cssAsset.path.startsWith('assets/_mirror/css/')).toBe(true);
    expect(fontAsset.path.startsWith('assets/_mirror/font/')).toBe(true);
    // The mirrored CSS body must reference the woff2 by a sibling-relative path.
    const css = new TextDecoder().decode(result.entries.get(cssAsset.path)!);
    expect(css).not.toContain('https://cdn.example.com/font.woff2');
    expect(css).toContain('../font/');
  });

  it('deduplicates identical bytes seen at different URLs', async () => {
    const html = `
      <img src="https://a.example.com/img.png" />
      <img src="https://b.example.com/img.png" />
    `;
    const bytes = new Uint8Array([10, 20, 30]);
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher } = recordingFetcher({
      'https://a.example.com/img.png': { ok: true, bytes, contentType: 'image/png' },
      'https://b.example.com/img.png': { ok: true, bytes, contentType: 'image/png' },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow },
    );
    // Both URLs got mirrored as separate entries but share the same path.
    expect(result.offline.mirroredAssets).toHaveLength(2);
    const paths = new Set(result.offline.mirroredAssets.map((a) => a.path));
    expect(paths.size).toBe(1);
    // Only one entry exists for that path in the package.
    const onlyPath = Array.from(paths)[0];
    expect(result.entries.has(onlyPath)).toBe(true);
  });

  it('updates manifest.assets to include the mirrored files', async () => {
    const html = '<img src="https://images.example.com/hero.png" />';
    const entries = new Map<string, Uint8Array>([
      ['slides/01-cover.html', bytesFromString(html)],
    ]);
    const manifest = manifestForSlides([
      { index: 1, id: 'cover', file: 'slides/01-cover.html' },
    ]);
    const { fetcher } = recordingFetcher({
      'https://images.example.com/hero.png': {
        ok: true,
        bytes: new Uint8Array([1, 2, 3, 4, 5]),
        contentType: 'image/png',
      },
    });
    const result = await mirrorExternalAssets(
      { entries, manifest },
      { fetcher, now: fixedNow },
    );
    const assets = result.manifest.assets as {
      totalSize: number;
      count: number;
      files: Array<{ path: string; size: number; type: string }>;
    };
    expect(assets.count).toBe(1);
    expect(assets.totalSize).toBe(5);
    expect(assets.files[0].path).toBe(result.offline.mirroredAssets[0].path);
    expect(assets.files[0].type).toBe('image');
  });
});

describe('createNetworkFetcher SSRF guard', () => {
  interface Route {
    status: number;
    location?: string;
    body?: Uint8Array;
    contentType?: string;
  }

  function fakeFetch(routes: Record<string, Route>): {
    impl: typeof fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      calls.push(url);
      const route = routes[url];
      if (!route) return new Response(null, { status: 404 });
      const headers = new Headers();
      if (route.location) headers.set('location', route.location);
      if (route.contentType) headers.set('content-type', route.contentType);
      const hasBody = route.status >= 200 && route.status < 300;
      let body: ArrayBuffer | null = null;
      if (hasBody) {
        const src = route.body ?? new Uint8Array();
        const ab = new ArrayBuffer(src.length);
        new Uint8Array(ab).set(src);
        body = ab;
      }
      return new Response(body, { status: route.status, headers });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('refuses an initial loopback URL without issuing any request', async () => {
    const { impl, calls } = fakeFetch({});
    const fetcher = createNetworkFetcher({ fetchImpl: impl });
    const res = await fetcher('http://127.0.0.1:9000/secret');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('blocked-by-policy');
    expect(calls).toEqual([]);
  });

  it('follows a public→public redirect and returns the final bytes', async () => {
    const { impl, calls } = fakeFetch({
      'https://cdn.example.com/a.png': {
        status: 302,
        location: 'https://cdn2.example.com/b.png',
      },
      'https://cdn2.example.com/b.png': {
        status: 200,
        body: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
      },
    });
    const fetcher = createNetworkFetcher({ fetchImpl: impl });
    const res = await fetcher('https://cdn.example.com/a.png');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.bytes)).toEqual([1, 2, 3]);
      expect(res.finalUrl).toBe('https://cdn2.example.com/b.png');
    }
    expect(calls).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn2.example.com/b.png',
    ]);
  });

  it('blocks a redirect that points at cloud metadata and never requests it', async () => {
    const { impl, calls } = fakeFetch({
      'https://cdn.example.com/a.png': {
        status: 302,
        location: 'http://169.254.169.254/latest/meta-data/',
      },
    });
    const fetcher = createNetworkFetcher({ fetchImpl: impl });
    const res = await fetcher('https://cdn.example.com/a.png');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('blocked-by-policy');
    expect(calls).toEqual(['https://cdn.example.com/a.png']);
  });

  it('allows a private target only when allowPrivateNetwork is set', async () => {
    const { impl } = fakeFetch({
      'http://127.0.0.1:9000/ok.png': {
        status: 200,
        body: new Uint8Array([9]),
        contentType: 'image/png',
      },
    });
    const fetcher = createNetworkFetcher({
      fetchImpl: impl,
      policy: { allowPrivateNetwork: true },
    });
    const res = await fetcher('http://127.0.0.1:9000/ok.png');
    expect(res.ok).toBe(true);
  });

  it('stops after maxRedirects hops', async () => {
    const { impl } = fakeFetch({
      'https://a.example.com/1': { status: 302, location: 'https://a.example.com/2' },
      'https://a.example.com/2': { status: 302, location: 'https://a.example.com/3' },
      'https://a.example.com/3': { status: 302, location: 'https://a.example.com/4' },
    });
    const fetcher = createNetworkFetcher({ fetchImpl: impl, maxRedirects: 2 });
    const res = await fetcher('https://a.example.com/1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toMatch(/too many redirects/);
  });
});

describe('createNetworkFetcher size cap (DSS-CAND-007)', () => {
  interface StreamOpts {
    status?: number;
    contentType?: string;
    /** Header value to expose; `null` omits the header entirely. */
    contentLength?: string | null;
    /** Chunks streamed out of the body, in order. */
    chunks: number[][];
  }

  function streamFetch(opts: StreamOpts): {
    impl: typeof fetch;
    state: { pulls: number; cancelled: boolean };
  } {
    const state = { pulls: 0, cancelled: false };
    const impl = (async () => {
      const headers = new Headers();
      if (opts.contentType) headers.set('content-type', opts.contentType);
      if (opts.contentLength !== null) {
        const declared =
          opts.contentLength ??
          String(opts.chunks.reduce((sum, c) => sum + c.length, 0));
        headers.set('content-length', declared);
      }
      const queue = opts.chunks.map((c) => Uint8Array.from(c));
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            state.pulls += 1;
            const next = queue.shift();
            if (next) controller.enqueue(next);
            else controller.close();
          },
          cancel() {
            state.cancelled = true;
          },
        },
        // highWaterMark 0: pull exactly once per read() with no prefetch, so a
        // precheck-only path performs zero pulls and an over-cap abort fires
        // `cancel()` before the stream auto-closes past its last chunk.
        { highWaterMark: 0 },
      );
      const status = opts.status ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        headers,
        body,
        arrayBuffer: async () => {
          throw new Error('arrayBuffer() must not be called on the streaming path');
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, state };
  }

  it('streams chunks and assembles the full body when under the cap', async () => {
    const { impl, state } = streamFetch({
      contentType: 'image/png',
      contentLength: null,
      chunks: [
        [1, 2, 3],
        [4, 5],
      ],
    });
    const fetcher = createNetworkFetcher({ fetchImpl: impl, maxBytes: 100 });
    const res = await fetcher('https://cdn.example.com/ok.png');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.bytes)).toEqual([1, 2, 3, 4, 5]);
      expect(res.contentType).toBe('image/png');
    }
    expect(state.cancelled).toBe(false);
  });

  it('rejects via Content-Length precheck without reading the body', async () => {
    const { impl, state } = streamFetch({
      contentLength: '1000000',
      chunks: [[1, 2, 3]],
    });
    const fetcher = createNetworkFetcher({ fetchImpl: impl, maxBytes: 4 });
    const res = await fetcher('https://cdn.example.com/big.bin');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('too-large');
      expect(res.detail).toMatch(/content-length/);
    }
    // Body was never read: the stream produced no pulls.
    expect(state.pulls).toBe(0);
  });

  it('aborts mid-stream once the running total exceeds the cap', async () => {
    const { impl, state } = streamFetch({
      // No Content-Length → precheck cannot help; the streaming guard must.
      contentLength: null,
      chunks: [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      ],
    });
    const fetcher = createNetworkFetcher({
      fetchImpl: impl,
      // Cap supplied via policy.maxAssetBytes to prove that path wires through.
      policy: { maxAssetBytes: 15 },
    });
    const res = await fetcher('https://cdn.example.com/chunked.bin');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('too-large');
      expect(res.detail).toMatch(/streaming/);
    }
    expect(state.cancelled).toBe(true);
  });
});
