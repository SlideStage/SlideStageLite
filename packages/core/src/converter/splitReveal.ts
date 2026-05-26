import type { Manifest, ManifestSlide, TrustCapability } from '../deck/types';
import { extractBalancedBlocks, type ExtractedBlock } from './htmlBlocks';
import { asPlainUint8, bytesFromString } from './pack';
import type { ConvertWarning } from './report';
import type { SniffResult } from './sniffer';
import { extractInlineNotes, findSlideNotes } from './speakerNotes';

// Lite-side port of slidestage-pack's dispatchSplitReveal. Splits a reveal.js
// deck (<div class="reveal"><div class="slides"><section>…</section>…</div></div>)
// into per-section .stage slides while preserving the .reveal/.slides wrapper
// inside each generated page so slide-scoped CSS keeps applying.
//
// Lossy by design: fragments, vertical stacks, and inter-slide transitions
// are dropped — wrap mode preserves them.

const textDecoder = new TextDecoder('utf-8', { fatal: false });

const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_TAG_RE = /<html\b([^>]*)>/i;
const BODY_TAG_RE = /<body\b([^>]*)>/i;
const DATA_TITLE_RE = /\bdata-title\s*=\s*("([^"]*)"|'([^']*)')/i;
const RUNTIME_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>\s*<\/script\s*>/gi;

const REVEAL_RUNTIME_PATTERNS = [
  /reveal(\.min)?\.js(?:[?#].*)?$/i,
  /reveal\/dist\/reveal\.js(?:[?#].*)?$/i,
];

const HIDE_INLINE_NOTES_STYLE =
  '<style data-injected-by="slidestage-converter">aside.notes,aside.speaker-notes,div.notes,div.speaker-notes,template#notes,template#speaker-notes{display:none!important}</style>';

export interface RevealSplitInput {
  rootHtmlPath: string;
  entries: Map<string, Uint8Array>;
  sniff: SniffResult;
}

export interface RevealSplitResult {
  packEntries: Map<string, Uint8Array>;
  slides: ManifestSlide[];
  architecture: Manifest['architecture'];
  warnings: ConvertWarning[];
  pageTitle: string;
  /** Populated when any extracted slide contains an inline <script> block. */
  compat: {
    requires: TrustCapability[];
    notes: string;
  } | null;
}

function decode(bytes: Uint8Array | undefined): string {
  if (!bytes) return '';
  return textDecoder.decode(bytes);
}

function readAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  const value = m[2] ?? m[3] ?? '';
  return value || null;
}

function hasClass(attrs: string, cls: string): boolean {
  const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!m) return false;
  return (m[2] ?? m[3] ?? '').split(/\s+/).includes(cls);
}

function reconstructOuter(tag: string, block: ExtractedBlock): string {
  return `<${tag}${block.attributes}>${block.innerHtml}</${tag}>`;
}

function firstHeadingText(html: string): string | null {
  for (const tag of ['h1', 'h2', 'h3']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = re.exec(html);
    if (!m) continue;
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return null;
}

function slugify(input: string, fallback: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48);
  return normalized || fallback;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return map[c] ?? c;
  });
}

function extractTitle(rootHtml: string): string {
  const head = HEAD_RE.exec(rootHtml);
  const haystack = head ? head[1] : rootHtml;
  const title = TITLE_RE.exec(haystack);
  if (!title) return 'Reveal deck';
  return title[1].replace(/\s+/g, ' ').trim().slice(0, 256) || 'Reveal deck';
}

function extractHeadInner(html: string): string {
  const m = HEAD_RE.exec(html);
  return m ? m[1] : '';
}

function extractHtmlAttrs(html: string): string {
  const m = HTML_TAG_RE.exec(html);
  return m ? m[1].trim() : '';
}

function extractBodyAttrs(html: string): string {
  const m = BODY_TAG_RE.exec(html);
  return m ? m[1].trim() : '';
}

function stripRuntimeScripts(
  source: string,
  patterns: RegExp[],
  warnings: ConvertWarning[],
): string {
  return source.replace(RUNTIME_SCRIPT_RE, (full, _q, dq, sq) => {
    const src = (dq ?? sq ?? '').trim();
    const drop = patterns.some((re) => re.test(src));
    if (!drop) return full;
    if (!warnings.some((w) => w.kind === 'runtime-dropped' && w.reason.includes(src))) {
      warnings.push({
        kind: 'runtime-dropped',
        reason: `Skipped <script src="${src}"> (host runtime owns navigation/transitions in split mode).`,
      });
    }
    return '';
  });
}

interface BuildPageOptions {
  pageTitle: string;
  headInner: string;
  body: string;
  htmlAttrs: string;
  bodyAttrs: string;
}

function buildSlidePage(opts: BuildPageOptions): string {
  const hasCharset = /<meta\b[^>]*\bcharset\s*=/i.test(opts.headInner);
  const hasTitle = /<title\b/i.test(opts.headInner);
  const extraHead = [
    hasCharset ? '' : '    <meta charset="utf-8" />',
    !hasTitle && opts.pageTitle ? `    <title>${escapeHtml(opts.pageTitle)}</title>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const htmlOpen = opts.htmlAttrs ? `<html ${opts.htmlAttrs}>` : '<html>';
  const bodyOpen = opts.bodyAttrs ? `<body ${opts.bodyAttrs}>` : '<body>';
  return `<!doctype html>
${htmlOpen}
  <head>
${extraHead}
${opts.headInner.trim()}
    ${HIDE_INLINE_NOTES_STYLE}
  </head>
  ${bodyOpen}
${opts.body}
  </body>
</html>
`;
}

function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.substring(0, i);
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function emptyResult(
  warningMessage: string,
  pageTitle: string,
  warnings: ConvertWarning[] = [],
): RevealSplitResult {
  return {
    packEntries: new Map(),
    slides: [],
    architecture: 'multi-file',
    warnings: [...warnings, { kind: 'note', message: warningMessage }],
    pageTitle,
    compat: null,
  };
}

export function splitReveal(input: RevealSplitInput): RevealSplitResult {
  const { rootHtmlPath, entries } = input;
  const warnings: ConvertWarning[] = [];

  const rootHtml = decode(entries.get(rootHtmlPath));
  if (!rootHtml) {
    throw new Error(`splitReveal: root HTML not found at ${rootHtmlPath}`);
  }

  const pageTitle = extractTitle(rootHtml);

  const revealBlocks = extractBalancedBlocks(rootHtml, {
    tagName: 'div',
    isMatch: (attrs) => hasClass(attrs, 'reveal'),
  });
  if (revealBlocks.length === 0) {
    return emptyResult(
      '[split:reveal] could not locate <div class="reveal"> container; falling back to wrap mode.',
      pageTitle,
    );
  }

  const slidesContainer = extractBalancedBlocks(revealBlocks[0].innerHtml, {
    tagName: 'div',
    isMatch: (attrs) => hasClass(attrs, 'slides'),
  });
  if (slidesContainer.length === 0) {
    return emptyResult(
      '[split:reveal] could not locate <div class="slides"> inside .reveal; falling back to wrap mode.',
      pageTitle,
    );
  }

  const sections = extractBalancedBlocks(slidesContainer[0].innerHtml, { tagName: 'section' });
  if (sections.length === 0) {
    return emptyResult(
      '[split:reveal] no <section> children inside .slides; falling back to wrap mode.',
      pageTitle,
    );
  }

  const rawHeadInner = extractHeadInner(rootHtml);
  const headInner = stripRuntimeScripts(rawHeadInner, REVEAL_RUNTIME_PATTERNS, warnings);
  // Also surface body-level runtime scripts (we drop them anyway since split
  // mode never copies the original body, but the warning is informative).
  void stripRuntimeScripts(rootHtml, REVEAL_RUNTIME_PATTERNS, warnings);
  const htmlAttrs = extractHtmlAttrs(rootHtml);
  const bodyAttrs = extractBodyAttrs(rootHtml);

  const baseDir = dirnameOf(rootHtmlPath);
  const packEntries = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    if (path === rootHtmlPath) continue;
    packEntries.set(path, asPlainUint8(bytes));
  }

  const usedFiles = new Set<string>();
  const manifestSlides: ManifestSlide[] = [];
  let anyInlineScript = false;

  sections.forEach((section, idx) => {
    const index = idx + 1;
    const heading = firstHeadingText(section.innerHtml);
    const dataTitle = readAttr(section.attributes, 'data-title');
    const label = (heading ?? dataTitle ?? `Slide ${index}`).slice(0, 256);
    const baseSlug = slugify(label, `slide-${index}`);
    const baseFilename = `${pad2(index)}-${baseSlug}.html`;

    let candidate = joinPath(baseDir, baseFilename);
    let suffix = 1;
    while (usedFiles.has(candidate) || packEntries.has(candidate)) {
      suffix += 1;
      candidate = joinPath(baseDir, `${pad2(index)}-${baseSlug}-${suffix}.html`);
    }
    usedFiles.add(candidate);

    const outer = reconstructOuter('section', section);
    if (/<script\b/i.test(outer)) anyInlineScript = true;

    const page = buildSlidePage({
      pageTitle: label,
      headInner,
      body: `    <div class="reveal"><div class="slides">${outer}</div></div>\n`,
      htmlAttrs,
      bodyAttrs,
    });
    packEntries.set(candidate, asPlainUint8(bytesFromString(page)));

    manifestSlides.push({
      index,
      id: baseSlug || `slide-${index}`,
      label,
      file: candidate,
      thumbnail: null,
      notes: extractInlineNotes(outer) ?? findSlideNotes(entries, candidate),
    });
  });

  warnings.push({
    kind: 'note',
    message:
      '[split:reveal] reveal.js fragments and inter-slide transitions are lost in split mode; use mode "wrap" to preserve them.',
  });

  const compat = anyInlineScript
    ? {
        requires: ['same-origin-storage' as TrustCapability],
        notes:
          'One or more split slides contain inline <script> blocks. Granting same-origin-storage lets that author code run inside the platform iframe.',
      }
    : null;

  return {
    packEntries,
    slides: manifestSlides,
    architecture: 'multi-file',
    warnings,
    pageTitle,
    compat,
  };
}
