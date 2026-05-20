import { resolvePackageReference, splitReferenceSuffix } from './pathSafety';

const attributePattern = /\b(src|href|poster)=("([^"]*)"|'([^']*)')/gi;
const srcsetPattern = /\bsrcset=("([^"]*)"|'([^']*)')/gi;
const srcdocPattern = /<iframe\b([^>]*?)\bsrcdoc=("([^"]*)"|'([^']*)')([^>]*)>/gi;
const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;
const cssImportStringPattern = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
// @import that we recursively inline when the target CSS is bundled in
// the deck. Both forms (url(...) and bare string) must match; the
// trailing semicolon is optional because some toolchains strip it.
// Media-query suffixes (e.g. `@import "foo" screen;`) are not captured
// here — those still hit the URL-rewrite fallback below and stay as
// `@import "data:..."` references, accepting the data-URL relative-
// path loss for the rare media-conditional case.
const cssImportInlinePattern =
  /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)|"([^"]*)"|'([^']*)')\s*;?/gi;
const linkTagPattern = /<link\b[^>]*>/gi;
const baseTagPattern = /<base\b[^>]*>/gi;
const inlineStyleTagPattern = /<style\s+data-slidestage-inline-css="([^"]+)">([\s\S]*?)<\/style>/gi;

const IMPORT_INLINE_DEPTH = 8;

type UrlLookup = (path: string) => string | null;
type TextLookup = (path: string) => string | null;

function rewriteReference(fromPath: string, value: string, lookup: UrlLookup): string {
  const resolved = resolvePackageReference(fromPath, value);
  if (!resolved) {
    return value;
  }

  const { suffix } = splitReferenceSuffix(value);
  const url = lookup(resolved);
  return url ? `${url}${suffix}` : value;
}

function rewriteSrcset(fromPath: string, value: string, lookup: UrlLookup): string {
  return value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) {
        return candidate;
      }
      return [rewriteReference(fromPath, parts[0], lookup), ...parts.slice(1)].join(' ');
    })
    .join(', ');
}

// Recursively inline `@import` references whose targets are
// package-local CSS files. Why this matters: the rewriteCssBody pass
// below only rewrites the URL inside `@import url(...)` — i.e.
// `@import url("../assets/_mirror/css/foo.css")` becomes
// `@import url("data:text/css;base64,<encoded foo.css>")` — but
// `data:` URLs have no base URL, so any `url(../font/...ttf)` *inside*
// `foo.css` resolves against the opaque-origin iframe and silently
// 404s. Mirrored decks always look like this: `shared/tokens.css`
// imports `assets/_mirror/css/<hash>.css`, which in turn references
// `assets/_mirror/font/<hash>.ttf` via a sibling-relative path. We
// have to splice the imported CSS body *into* the importing CSS so
// font references resolve relative to where the imported file actually
// lives — at which point they get rewritten to working data: URLs in
// the recursive call below.
function inlineCssImports(
  css: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText: TextLookup | undefined,
  visited: ReadonlySet<string>,
  depth: number,
): string {
  if (!lookupText || depth >= IMPORT_INLINE_DEPTH) {
    return css;
  }

  return css.replace(
    cssImportInlinePattern,
    (
      match,
      urlDouble?: string,
      urlSingle?: string,
      urlBare?: string,
      stringDouble?: string,
      stringSingle?: string,
    ) => {
      const ref =
        (urlDouble ?? urlSingle ?? urlBare ?? stringDouble ?? stringSingle ?? '').trim();
      if (!ref) return match;

      const resolved = resolvePackageReference(fromPath, ref);
      if (!resolved) {
        // External (https://, data:, etc.) or missing — leave the
        // @import alone so the URL-rewrite pass downstream gets a
        // chance to handle it.
        return match;
      }
      if (visited.has(resolved)) {
        // Cycle break: A → B → A. Drop the inner @import.
        return '';
      }
      const importedCss = lookupText(resolved);
      if (importedCss === null) {
        // We don't have the file (e.g. it's an SVG or missing).
        return match;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(resolved);
      const innerProcessed = rewriteCssBody(
        importedCss,
        resolved,
        lookup,
        lookupText,
        nextVisited,
        depth + 1,
      );
      return `/* slidestage:inlined @import ${resolved} */\n${innerProcessed}\n/* slidestage:end @import ${resolved} */\n`;
    },
  );
}

function rewriteCssBody(
  css: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText?: TextLookup,
  visited: ReadonlySet<string> = new Set(),
  depth: number = 0,
): string {
  // Phase 1: splice package-local @import targets into the body so
  // their sibling-relative url() refs resolve against the right base.
  const inlined = inlineCssImports(css, fromPath, lookup, lookupText, visited, depth);

  // Phase 2: rewrite url() refs (including the data:/https: ones inside
  // inlined bodies — those are no-ops because rewriteReference falls
  // through for external schemes).
  const afterUrls = inlined.replace(
    cssUrlPattern,
    (_match, doubleValue?: string, singleValue?: string, bareValue?: string) => {
      const value = (doubleValue ?? singleValue ?? bareValue ?? '').trim();
      return `url("${rewriteReference(fromPath, value, lookup)}")`;
    },
  );

  // Phase 3: any @import string-form survivors (external CDN imports,
  // missing files) still get their URL rewritten so the loader's
  // lookup gets a chance to point them at a virtual URL.
  return afterUrls.replace(
    cssImportStringPattern,
    (_match, doubleValue?: string, singleValue?: string) => {
      const value = (doubleValue ?? singleValue ?? '').trim();
      return `@import "${rewriteReference(fromPath, value, lookup)}"`;
    },
  );
}

function getAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match?.[2] ?? match?.[3] ?? null;
}

function unescapeHtmlAttr(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtmlAttr(value: string, quoteChar: '"' | "'"): string {
  const base = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return quoteChar === '"' ? base.replace(/"/g, '&quot;') : base.replace(/'/g, '&#39;');
}

function inlineStylesheetLinks(
  html: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText?: TextLookup,
): string {
  if (!lookupText) {
    return html;
  }

  return html.replace(linkTagPattern, (tag) => {
    const rel = getAttribute(tag, 'rel');
    const href = getAttribute(tag, 'href');
    if (!rel?.toLowerCase().split(/\s+/).includes('stylesheet') || !href) {
      return tag;
    }

    const resolved = resolvePackageReference(fromPath, href);
    const css = resolved ? lookupText(resolved) : null;
    if (!resolved || css === null) {
      return tag;
    }

    // Pass `lookupText` and a fresh visited set so the imported CSS
    // can in turn splice ITS own `@import` targets in (mirrored decks
    // typically chain `shared/tokens.css` → `assets/_mirror/css/...`).
    const visited = new Set<string>([resolved]);
    const rewrittenCss = rewriteCssBody(css, resolved, lookup, lookupText, visited).replace(
      /<\/style/gi,
      '<\\/style',
    );
    return `<style data-slidestage-inline-css="${resolved}">\n${rewrittenCss}\n</style>`;
  });
}

// After inlining package-internal CSS, any remaining `<link rel="stylesheet">`
// points outside the package (CDNs, Google Fonts, etc.). When the host is
// offline or behind a hostile firewall those requests stall and block the
// first paint — symptom: a fully-white iframe that eventually shows up
// only after each external link finally times out. We rewrite these into
// non-blocking loads (`media="print" onload="this.media='all'"`) so the
// slide renders immediately and the font/theme stylesheet "upgrades" the
// look-and-feel asynchronously when (and if) it arrives.
function deferExternalStylesheetLinks(html: string): string {
  return html.replace(linkTagPattern, (tag) => {
    const rel = getAttribute(tag, 'rel');
    const href = getAttribute(tag, 'href');
    if (!rel?.toLowerCase().split(/\s+/).includes('stylesheet') || !href) {
      return tag;
    }
    if (/\bmedia\s*=/i.test(tag) || /\bonload\s*=/i.test(tag)) {
      return tag;
    }
    return tag.replace(
      /<link\b/i,
      `<link media="print" onload="this.media='all';this.removeAttribute('onload');"`,
    );
  });
}

// Strict variant used by the desktop srcdoc flavour. Walled networks (e.g.
// hosts that can't reach fonts.googleapis.com) still pay a heavy TLS
// timeout per external stylesheet/preconnect even when the link is
// "async" — meanwhile our iframe sits half-rendered. Inside the Tauri
// webview we therefore drop external link/preconnect refs outright,
// gracefully degrading to system fonts so the deck always renders.
const externalProtocol = /^(?:https?:)?\/\//i;
export function stripExternalLinkReferences(html: string): string {
  return html.replace(linkTagPattern, (tag) => {
    const href = getAttribute(tag, 'href');
    if (!href || !externalProtocol.test(href)) {
      return tag;
    }
    const rel = getAttribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (
      rel.includes('stylesheet') ||
      rel.includes('preconnect') ||
      rel.includes('dns-prefetch') ||
      rel.includes('preload')
    ) {
      return '';
    }
    return tag;
  });
}

function rewriteBaseTag(html: string, fromPath: string, lookup: UrlLookup): string {
  return html.replace(baseTagPattern, (tag) => {
    const href = getAttribute(tag, 'href');
    if (!href) {
      return tag;
    }

    const resolved = resolvePackageReference(fromPath, href);
    if (!resolved) {
      if (typeof console !== 'undefined') {
        console.warn(
          `[slidestage] Slide ${fromPath} declares <base href="${href}">; left unchanged because it is external.`,
        );
      }
      return tag;
    }

    const url = lookup(resolved);
    if (!url) {
      if (typeof console !== 'undefined') {
        console.warn(
          `[slidestage] Slide ${fromPath} declares <base href="${href}"> pointing at missing ${resolved}; dropping <base>.`,
        );
      }
      return '';
    }

    return tag.replace(/\bhref\s*=\s*(?:"[^"]*"|'[^']*')/i, `href="${url}"`);
  });
}

function rewriteSrcdocAttributes(
  html: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText: TextLookup | undefined,
  depth: number,
): string {
  if (depth >= 4) {
    return html;
  }

  return html.replace(
    srcdocPattern,
    (_match, beforeAttrs: string, quoted: string, doubleValue?: string, singleValue?: string, afterAttrs: string = '') => {
      const quote: '"' | "'" = quoted.startsWith('"') ? '"' : "'";
      const raw = doubleValue ?? singleValue ?? '';
      const innerHtml = unescapeHtmlAttr(raw);
      const rewrittenInner = applyRewrites(innerHtml, fromPath, lookup, lookupText, depth + 1);
      const escaped = escapeHtmlAttr(rewrittenInner, quote);
      return `<iframe${beforeAttrs} srcdoc=${quote}${escaped}${quote}${afterAttrs}>`;
    },
  );
}

function rewriteAttributes(html: string, fromPath: string, lookup: UrlLookup): string {
  return html.replace(
    attributePattern,
    (_match, attr: string, quoted: string, doubleValue?: string, singleValue?: string) => {
      const quote = quoted.startsWith('"') ? '"' : "'";
      const value = doubleValue ?? singleValue ?? '';
      return `${attr}=${quote}${rewriteReference(fromPath, value, lookup)}${quote}`;
    },
  );
}

function rewriteSrcsetAttributes(html: string, fromPath: string, lookup: UrlLookup): string {
  return html.replace(
    srcsetPattern,
    (_match, quoted: string, doubleValue?: string, singleValue?: string) => {
      const quote = quoted.startsWith('"') ? '"' : "'";
      const value = doubleValue ?? singleValue ?? '';
      return `srcset=${quote}${rewriteSrcset(fromPath, value, lookup)}${quote}`;
    },
  );
}

function rewriteRemainingCss(
  html: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText?: TextLookup,
): string {
  // Protect already-inlined <style data-slidestage-inline-css="X"> blocks. Their
  // bodies were rewritten against X (the inline source path); re-running the
  // CSS rewriter on them with fromPath as the base would corrupt any url(...)
  // or @import that did not resolve on the first pass.
  const placeholders: string[] = [];
  const protectedHtml = html.replace(inlineStyleTagPattern, (match) => {
    placeholders.push(match);
    return `\u0000SLIDESTAGE_INLINE_CSS_${placeholders.length - 1}\u0000`;
  });

  // Slide-authored <style> blocks can also use @import; pass lookupText
  // so those get spliced in too. The fromPath is the slide's path —
  // url() refs in inlined @import bodies still resolve correctly
  // because rewriteCssBody re-bases against each imported file.
  const rewritten = rewriteCssBody(protectedHtml, fromPath, lookup, lookupText);

  return rewritten.replace(/\u0000SLIDESTAGE_INLINE_CSS_(\d+)\u0000/g, (_match, idx: string) => {
    return placeholders[Number(idx)] ?? '';
  });
}

function applyRewrites(
  html: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText: TextLookup | undefined,
  depth: number,
): string {
  const withBase = rewriteBaseTag(html, fromPath, lookup);
  const withInlineCss = inlineStylesheetLinks(withBase, fromPath, lookup, lookupText);
  const withDeferredLinks = deferExternalStylesheetLinks(withInlineCss);
  const withSrcdoc = rewriteSrcdocAttributes(withDeferredLinks, fromPath, lookup, lookupText, depth);
  const withAttributes = rewriteAttributes(withSrcdoc, fromPath, lookup);
  const withSrcset = rewriteSrcsetAttributes(withAttributes, fromPath, lookup);
  return rewriteRemainingCss(withSrcset, fromPath, lookup, lookupText);
}

export function rewriteHtmlAssetReferences(
  html: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText?: TextLookup,
): string {
  return applyRewrites(html, fromPath, lookup, lookupText, 0);
}
