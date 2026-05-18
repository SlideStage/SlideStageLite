import { resolvePackageReference, splitReferenceSuffix } from './pathSafety';

const attributePattern = /\b(src|href|poster)=("([^"]*)"|'([^']*)')/gi;
const srcsetPattern = /\bsrcset=("([^"]*)"|'([^']*)')/gi;
const srcdocPattern = /<iframe\b([^>]*?)\bsrcdoc=("([^"]*)"|'([^']*)')([^>]*)>/gi;
const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;
const cssImportStringPattern = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const linkTagPattern = /<link\b[^>]*>/gi;
const baseTagPattern = /<base\b[^>]*>/gi;
const inlineStyleTagPattern = /<style\s+data-hcslides-inline-css="([^"]+)">([\s\S]*?)<\/style>/gi;

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

function rewriteCssBody(css: string, fromPath: string, lookup: UrlLookup): string {
  const afterUrls = css.replace(
    cssUrlPattern,
    (_match, doubleValue?: string, singleValue?: string, bareValue?: string) => {
      const value = (doubleValue ?? singleValue ?? bareValue ?? '').trim();
      return `url("${rewriteReference(fromPath, value, lookup)}")`;
    },
  );

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

    const rewrittenCss = rewriteCssBody(css, resolved, lookup).replace(/<\/style/gi, '<\\/style');
    return `<style data-hcslides-inline-css="${resolved}">\n${rewrittenCss}\n</style>`;
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
          `[hcslides] Slide ${fromPath} declares <base href="${href}">; left unchanged because it is external.`,
        );
      }
      return tag;
    }

    const url = lookup(resolved);
    if (!url) {
      if (typeof console !== 'undefined') {
        console.warn(
          `[hcslides] Slide ${fromPath} declares <base href="${href}"> pointing at missing ${resolved}; dropping <base>.`,
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

function rewriteRemainingCss(html: string, fromPath: string, lookup: UrlLookup): string {
  // Protect already-inlined <style data-hcslides-inline-css="X"> blocks. Their
  // bodies were rewritten against X (the inline source path); re-running the
  // CSS rewriter on them with fromPath as the base would corrupt any url(...)
  // or @import that did not resolve on the first pass.
  const placeholders: string[] = [];
  const protectedHtml = html.replace(inlineStyleTagPattern, (match) => {
    placeholders.push(match);
    return `\u0000HCSLIDES_INLINE_CSS_${placeholders.length - 1}\u0000`;
  });

  const rewritten = rewriteCssBody(protectedHtml, fromPath, lookup);

  return rewritten.replace(/\u0000HCSLIDES_INLINE_CSS_(\d+)\u0000/g, (_match, idx: string) => {
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
  return rewriteRemainingCss(withSrcset, fromPath, lookup);
}

export function rewriteHtmlAssetReferences(
  html: string,
  fromPath: string,
  lookup: UrlLookup,
  lookupText?: TextLookup,
): string {
  return applyRewrites(html, fromPath, lookup, lookupText, 0);
}
