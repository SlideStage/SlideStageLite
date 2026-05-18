import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rewriteHtmlAssetReferences, stripExternalLinkReferences } from './rewriteHtml';

function makeLookup(map: Record<string, string>) {
  return (path: string) => map[path] ?? null;
}

function makeTextLookup(map: Record<string, string>) {
  return (path: string) => map[path] ?? null;
}

describe('rewriteHtmlAssetReferences', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('basic attributes', () => {
    it('rewrites src/href/poster to lookup URLs', () => {
      const lookup = makeLookup({
        'shared/logo.png': 'blob:logo',
        'shared/poster.jpg': 'blob:poster',
        'shared/page.html': 'blob:page',
      });

      const html = `
        <img src="../shared/logo.png" />
        <a href="../shared/page.html">go</a>
        <video poster="../shared/poster.jpg"></video>
      `;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);

      expect(rewritten).toContain('src="blob:logo"');
      expect(rewritten).toContain('href="blob:page"');
      expect(rewritten).toContain('poster="blob:poster"');
    });

    it('leaves external schemes alone', () => {
      const lookup = makeLookup({});
      const html = `
        <img src="https://example.com/logo.png" />
        <a href="mailto:hi@example.com">contact</a>
      `;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('src="https://example.com/logo.png"');
      expect(rewritten).toContain('href="mailto:hi@example.com"');
    });

    it('rewrites srcset candidates', () => {
      const lookup = makeLookup({
        'shared/img@1x.png': 'blob:1x',
        'shared/img@2x.png': 'blob:2x',
      });
      const html = `<img srcset="../shared/img@1x.png 1x, ../shared/img@2x.png 2x" />`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('srcset="blob:1x 1x, blob:2x 2x"');
    });
  });

  describe('CSS url()', () => {
    it('rewrites url(...) in <style> blocks against fromPath', () => {
      const lookup = makeLookup({
        'slides/img/bg.png': 'blob:bg',
      });
      const html = `<style>.s { background: url('./img/bg.png'); }</style>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('url("blob:bg")');
    });
  });

  describe('@import string form', () => {
    it('rewrites @import "..." to lookup URL', () => {
      const lookup = makeLookup({
        'shared/extra.css': 'blob:extra',
      });
      const html = `<style>@import "../shared/extra.css";\n.s{}</style>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('@import "blob:extra"');
    });

    it('keeps @import "..." for unknown paths', () => {
      const lookup = makeLookup({});
      const html = `<style>@import "../missing.css";</style>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('@import "../missing.css"');
    });

    it('rewrites @import url(...) via the cssUrl pass as well', () => {
      const lookup = makeLookup({
        'shared/extra.css': 'blob:extra',
      });
      const html = `<style>@import url("../shared/extra.css");</style>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('url("blob:extra")');
    });
  });

  describe('<iframe srcdoc>', () => {
    it('rewrites <iframe srcdoc> contents against the outer slide path (single quoted)', () => {
      const lookup = makeLookup({
        'shared/logo.png': 'blob:logo',
      });
      // Single-quoted srcdoc may contain unescaped " inside; we still rewrite.
      const html = `<iframe srcdoc='<img src="../shared/logo.png" />'></iframe>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('src="blob:logo"');
      expect(rewritten).toMatch(/<iframe[\s\S]*srcdoc='/);
    });

    it('rewrites <iframe srcdoc> contents against the outer slide path (double quoted)', () => {
      const lookup = makeLookup({
        'shared/logo.png': 'blob:logo',
      });
      const html = `<iframe srcdoc="<img src=&quot;../shared/logo.png&quot; />"></iframe>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      // Outer quote is " so the inner " must be escaped to &quot;
      expect(rewritten).toContain('src=&quot;blob:logo&quot;');
    });

    it('does not recurse forever on nested srcdoc', () => {
      const lookup = makeLookup({
        'shared/x.png': 'blob:x',
      });
      const nested = `<iframe srcdoc=&quot;<iframe srcdoc=&amp;quot;<img src=&amp;amp;quot;../shared/x.png&amp;amp;quot; />&amp;quot;></iframe>&quot;></iframe>`;
      const html = `<iframe srcdoc="${nested}"></iframe>`;
      expect(() => rewriteHtmlAssetReferences(html, 'slides/01.html', lookup)).not.toThrow();
    });
  });

  describe('<base href>', () => {
    it('keeps external base href and warns', () => {
      const lookup = makeLookup({});
      const html = `<head><base href="https://example.com/" /></head>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('<base href="https://example.com/"');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rewrites relative base href to a blob URL when known', () => {
      const lookup = makeLookup({
        'shared/index.html': 'blob:shared-index',
      });
      const html = `<head><base href="../shared/index.html" /></head>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('href="blob:shared-index"');
    });

    it('drops base when relative href is unknown and warns', () => {
      const lookup = makeLookup({});
      const html = `<head><base href="../shared/missing/" /></head>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).not.toContain('<base');
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('inline-CSS path-base bug', () => {
    it('does not re-apply slide fromPath to url() inside inlined <style data-hcslides-inline-css>', () => {
      // The CSS file lives at `shared/theme.css` and references a sibling
      // `shared/missing.png`. The asset is intentionally absent from lookup so
      // the first pass leaves it as `./missing.png`. The bug being fixed: the
      // final cssUrls rewrite must NOT use the slide's fromPath
      // (`slides/01.html`) as base; doing so would resolve to
      // `slides/missing.png` and silently mislead future debugging.
      const lookup = makeLookup({
        // No 'shared/missing.png' on purpose.
        // No 'slides/missing.png' either: with the bug the final pass would
        // also miss, but the URL string in the output would say it tried to
        // resolve against slides/01.html instead of shared/theme.css.
      });
      const lookupText = makeTextLookup({
        'shared/theme.css': `.s { background: url("./missing.png"); }`,
      });
      const html = `<link rel="stylesheet" href="../shared/theme.css" />`;
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'slides/01.html',
        lookup,
        lookupText,
      );

      // Inlined block exists and still references the un-rewritten path:
      expect(rewritten).toContain('<style data-hcslides-inline-css="shared/theme.css">');
      expect(rewritten).toContain('url("./missing.png")');

      // It must NOT have been re-wrapped or mutated by the final rewrite.
      // (If the bug returned, the body would change shape because the second
      // rewriteCssUrls would touch it; we lock in the literal string.)
      const inlineBlock = rewritten.match(
        /<style data-hcslides-inline-css="shared\/theme\.css">[\s\S]*?<\/style>/,
      );
      expect(inlineBlock?.[0]).toBeDefined();
      expect(inlineBlock?.[0]).toContain('url("./missing.png")');
    });

    it('still rewrites url() that lives in a slide-authored <style> block', () => {
      // Author-written <style> blocks (no data-hcslides-inline-css marker) must
      // continue to be rewritten against the slide's fromPath.
      const lookup = makeLookup({
        'slides/img/spot.png': 'blob:spot',
      });
      const html = `<style>.s { background: url("./img/spot.png"); }</style>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('url("blob:spot")');
    });
  });

  describe('non-blocking external stylesheets', () => {
    // Rationale: deck authors frequently link Google Fonts / CDN themes via
    // `<link rel="stylesheet" href="https://…">`. When the host is offline
    // those requests stall paint for tens of seconds. The Web flavour gets a
    // non-blocking shim so the iframe paints immediately and styling
    // "upgrades" later if/when the request lands.
    it('rewrites external stylesheet links to media="print" with onload swap', () => {
      const lookup = makeLookup({});
      const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('media="print"');
      expect(rewritten).toContain("this.media='all'");
      expect(rewritten).toContain('https://fonts.googleapis.com/css2?family=Inter');
    });

    it('leaves internal stylesheet links untouched once inlined', () => {
      const lookup = makeLookup({});
      const textLookup = makeTextLookup({
        'slides/theme.css': 'body { color: red; }',
      });
      const html = `<link rel="stylesheet" href="./theme.css" />`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup, textLookup);
      expect(rewritten).toContain('data-hcslides-inline-css="slides/theme.css"');
      expect(rewritten).not.toContain('media="print"');
    });

    it('does not double-rewrite a link that already has media set', () => {
      const lookup = makeLookup({});
      const html = `<link rel="stylesheet" href="https://x.test/a.css" media="screen" />`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      // Existing media attribute is preserved (not replaced) — our shim
      // is opt-in only for default media.
      expect(rewritten).toContain('media="screen"');
      expect(rewritten).not.toContain("this.media='all'");
    });
  });
});

describe('stripExternalLinkReferences', () => {
  // Backstop for the Tauri srcdoc flavour: WKWebView can hang for ~30s per
  // unreachable CDN stylesheet/preconnect before the page paints. Strip
  // them up front so the slide always renders, even on a firewalled host.
  it('drops external stylesheet links', () => {
    const html = `
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
      <link rel="stylesheet" href="data:text/css,body%7Bcolor:red%7D" />
    `;
    const stripped = stripExternalLinkReferences(html);
    expect(stripped).not.toContain('fonts.googleapis.com');
    // Non-http data: URLs are not external and should survive.
    expect(stripped).toContain('data:text/css');
  });

  it('drops preconnect / dns-prefetch / preload as=style', () => {
    const html = `
      <link rel="preconnect" href="https://fonts.gstatic.com" />
      <link rel="dns-prefetch" href="//cdn.example.test" />
      <link rel="preload" as="style" href="https://x.test/a.css" />
    `;
    const stripped = stripExternalLinkReferences(html);
    expect(stripped).not.toContain('fonts.gstatic.com');
    expect(stripped).not.toContain('cdn.example.test');
    expect(stripped).not.toContain('x.test');
  });

  it('keeps unrelated link tags (icon, manifest, internal)', () => {
    const html = `
      <link rel="icon" href="https://example.test/icon.png" />
      <link rel="manifest" href="https://example.test/manifest.json" />
      <link rel="stylesheet" href="./local.css" />
    `;
    const stripped = stripExternalLinkReferences(html);
    expect(stripped).toContain('rel="icon"');
    expect(stripped).toContain('rel="manifest"');
    expect(stripped).toContain('./local.css');
  });
});
