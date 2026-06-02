import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rewriteHtmlAssetReferences, stripExternalLinkReferences } from '@slidestage/core/deck/rewriteHtml';

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
    it('rewrites @import "..." to lookup URL when no textLookup is supplied', () => {
      const lookup = makeLookup({
        'shared/extra.css': 'blob:extra',
      });
      // No textLookup → no inline; fall back to URL rewrite.
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

    it('rewrites @import url(...) via the cssUrl pass when no textLookup is supplied', () => {
      const lookup = makeLookup({
        'shared/extra.css': 'blob:extra',
      });
      const html = `<style>@import url("../shared/extra.css");</style>`;
      const rewritten = rewriteHtmlAssetReferences(html, 'slides/01.html', lookup);
      expect(rewritten).toContain('url("blob:extra")');
    });

    it('recursively inlines @import url(...) bodies so nested url() refs resolve against the imported file', () => {
      // Why this matters: mirrored decks chain `shared/tokens.css` →
      // `@import url("../assets/_mirror/css/foo.css")` → `@font-face
      // url("../font/<hash>.ttf")`. Without recursive inlining we would
      // rewrite the @import to a `data:text/css;base64,...` URL — but
      // data: URLs have no base, so `../font/<hash>.ttf` inside that
      // CSS body silently 404s.
      const lookup = makeLookup({
        'assets/_mirror/font/abc.ttf': 'data:font/ttf;base64,FAKE',
      });
      const lookupText = makeTextLookup({
        'shared/tokens.css': `:root { --sans: 'Inter'; }\n@import url("../assets/_mirror/css/main.css");`,
        'assets/_mirror/css/main.css': `@font-face { src: url("../font/abc.ttf") format('truetype'); }`,
      });
      const html = `<link rel="stylesheet" href="../shared/tokens.css">`;
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'slides/01.html',
        lookup,
        lookupText,
      );

      // The mirrored CSS body must have been spliced *into* tokens.css
      // and its sibling-relative `../font/abc.ttf` resolved to a
      // working data: URL.
      expect(rewritten).toContain('<style data-slidestage-inline-css="shared/tokens.css">');
      expect(rewritten).toContain('url("data:font/ttf;base64,FAKE")');
      // The `@import url(...)` must be gone from the final body so the
      // browser doesn't try to re-fetch the (now meaningless) reference.
      expect(rewritten).not.toContain('@import url(');
      // The slidestage:inlined marker is the only breadcrumb we leave
      // behind so the diff is debuggable.
      expect(rewritten).toContain('slidestage:inlined @import assets/_mirror/css/main.css');
    });

    it('recursively inlines @import "..." string form too', () => {
      const lookup = makeLookup({
        'assets/_mirror/font/x.woff2': 'data:font/woff2;base64,WW',
      });
      const lookupText = makeTextLookup({
        'shared/tokens.css': `@import "../assets/_mirror/css/main.css";`,
        'assets/_mirror/css/main.css': `@font-face { src: url('../font/x.woff2') format('woff2'); }`,
      });
      const html = `<link rel="stylesheet" href="../shared/tokens.css">`;
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'slides/01.html',
        lookup,
        lookupText,
      );

      expect(rewritten).toContain('url("data:font/woff2;base64,WW")');
      // No surviving string-form @import either.
      expect(rewritten).not.toMatch(/@import\s+(?:"|'|url\()/);
    });

    it('falls back to URL rewrite for @import targets that are not in the package', () => {
      const lookup = makeLookup({});
      const lookupText = makeTextLookup({
        'shared/tokens.css': `@import "../assets/_mirror/css/main.css";`,
        // Note: main.css intentionally missing from lookupText so the
        // recursive inliner has to give up.
      });
      const html = `<link rel="stylesheet" href="../shared/tokens.css">`;
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'slides/01.html',
        lookup,
        lookupText,
      );
      // The @import stays put with the resolved path written back so
      // the eventual SW or browser load can still find it via the
      // host transport.
      expect(rewritten).toContain('@import "../assets/_mirror/css/main.css"');
    });

    it('breaks @import cycles (A → B → A)', () => {
      const lookup = makeLookup({});
      const lookupText = makeTextLookup({
        'a.css': `@import "b.css";\n.a {}`,
        'b.css': `@import "a.css";\n.b {}`,
      });
      const html = `<link rel="stylesheet" href="a.css">`;
      // Should not loop forever and should keep at least the leaf
      // rules from both files.
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'index.html',
        lookup,
        lookupText,
      );
      expect(rewritten).toContain('.a');
      expect(rewritten).toContain('.b');
      // The inner @import was dropped to break the cycle.
      const aImports = (rewritten.match(/slidestage:inlined @import a\.css/g) ?? []).length;
      expect(aImports).toBeLessThanOrEqual(1);
    });

    it('handles deep @import chains up to the inline depth cap', () => {
      const lookup = makeLookup({
        'leaf.woff2': 'data:font/woff2;base64,LEAF',
      });
      const lookupText = makeTextLookup({
        'a.css': `@import "b.css";`,
        'b.css': `@import "c.css";`,
        'c.css': `@import "d.css";`,
        'd.css': `@font-face { src: url('leaf.woff2') format('woff2'); }`,
      });
      const html = `<link rel="stylesheet" href="a.css">`;
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'index.html',
        lookup,
        lookupText,
      );
      expect(rewritten).toContain('url("data:font/woff2;base64,LEAF")');
    });

    it('caps cumulative @import inlining so a fan-out graph cannot amplify (DSS-CAND-006)', () => {
      // The per-chain cycle guard does NOT stop sibling imports of the same
      // large file from each being spliced, so a tiny archive can fan out to
      // gigabytes of in-memory CSS. The cumulative budget must stop that.
      const big = `.b{content:"${'A'.repeat(600_000)}"}`; // ~600 KB each
      const root = '@import "big.css";\n'.repeat(20); // 20 × 600 KB ≈ 12 MB attempted
      const lookup = makeLookup({});
      const lookupText = makeTextLookup({ 'root.css': root, 'big.css': big });
      const html = `<link rel="stylesheet" href="root.css">`;

      const rewritten = rewriteHtmlAssetReferences(html, 'index.html', lookup, lookupText);

      // The budget tripped: at least one import was left as a reference.
      expect(rewritten).toContain('budget exceeded');
      // Output is bounded well under the naive 20× expansion (≈12 MB); the
      // 8 MiB cap means roughly a third of the imports stay as references.
      expect(rewritten.length).toBeLessThan(20 * big.length);
      // Some — but not all — imports were actually inlined.
      const inlinedCount = (rewritten.match(/slidestage:inlined @import big\.css/g) ?? []).length;
      expect(inlinedCount).toBeGreaterThan(0);
      expect(inlinedCount).toBeLessThan(20);
    });

    it('does not double-prefix already-virtual URLs when the lookup returns absolute paths', () => {
      // Regression: with the SW transport, lookup returns
      // `/__stage/<id>/<resolved>` URLs. The inner `url("../font/x.ttf")`
      // inside a chained @import gets rewritten to a virtual URL by the
      // recursive pass; the outer pass MUST NOT rewrite that virtual URL
      // a second time (which would prepend the outer file's dirname and
      // produce e.g. `/__stage/<id>/shared/__stage/<id>/assets/font/x.ttf`,
      // causing every font to 404).
      const lookup = (path: string) => `/__stage/abc/${path}`;
      const lookupText = makeTextLookup({
        'shared/tokens.css': `@import url("../assets/_mirror/css/main.css");`,
        'assets/_mirror/css/main.css': `@font-face { src: url('../font/x.ttf') format('truetype'); }`,
      });
      const html = `<link rel="stylesheet" href="../shared/tokens.css">`;
      const rewritten = rewriteHtmlAssetReferences(
        html,
        'slides/01.html',
        lookup,
        lookupText,
      );
      expect(rewritten).toContain(
        'url("/__stage/abc/assets/_mirror/font/x.ttf")',
      );
      expect(rewritten).not.toContain(
        '/__stage/abc/shared/__stage/',
      );
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
    it('does not re-apply slide fromPath to url() inside inlined <style data-slidestage-inline-css>', () => {
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
      expect(rewritten).toContain('<style data-slidestage-inline-css="shared/theme.css">');
      expect(rewritten).toContain('url("./missing.png")');

      // It must NOT have been re-wrapped or mutated by the final rewrite.
      // (If the bug returned, the body would change shape because the second
      // rewriteCssUrls would touch it; we lock in the literal string.)
      const inlineBlock = rewritten.match(
        /<style data-slidestage-inline-css="shared\/theme\.css">[\s\S]*?<\/style>/,
      );
      expect(inlineBlock?.[0]).toBeDefined();
      expect(inlineBlock?.[0]).toContain('url("./missing.png")');
    });

    it('still rewrites url() that lives in a slide-authored <style> block', () => {
      // Author-written <style> blocks (no data-slidestage-inline-css marker) must
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
      expect(rewritten).toContain('data-slidestage-inline-css="slides/theme.css"');
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
