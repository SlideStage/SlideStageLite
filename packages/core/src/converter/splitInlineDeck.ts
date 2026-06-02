import type { Manifest, ManifestSlide } from '../deck/types';
import { extractBalancedBlocks, type ExtractedBlock } from './htmlBlocks';
import { asPlainUint8, bytesFromString } from './pack';
import type { ConvertWarning } from './report';
import type { SniffResult } from './sniffer';
import { htmlRetainsScript, splitScriptCompat, type SplitScriptCompat } from './splitCompat';
import { extractInlineNotes, findSlideNotes } from './speakerNotes';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

const SLIDE_CLASS_RE = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
const DATA_TITLE_RE = /\bdata-title\s*=\s*("([^"]*)"|'([^']*)')/i;
const H1_TEXT_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const BODY_OPEN_RE = /<body\b[^>]*>/i;
const BODY_CLOSE_RE = /<\/body\s*>/i;

const RUNTIME_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>\s*<\/script\s*>/gi;
const RUNTIME_PATH_PATTERNS = [/runtime\.js(?:[?#].*)?$/i, /fx-runtime\.js(?:[?#].*)?$/i];

export interface SplitInput {
  rootHtmlPath: string;
  entries: Map<string, Uint8Array>;
  sniff: SniffResult;
}

export interface SplitResult {
  packEntries: Map<string, Uint8Array>;
  slides: ManifestSlide[];
  architecture: Manifest['architecture'];
  warnings: ConvertWarning[];
  pageTitle: string;
  /** Populated when any generated slide retains author scripts (head or body). */
  compat: SplitScriptCompat | null;
}

interface ExtractedSlide {
  slug: string;
  label: string;
  attributes: string;
  innerHtml: string;
}

function readBytesAsString(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) return '';
  return textDecoder.decode(bytes);
}

function stripRuntimeScripts(html: string, warnings: ConvertWarning[]): string {
  return html.replace(RUNTIME_SCRIPT_RE, (full, _quoted, dq, sq) => {
    const src = (dq ?? sq ?? '').trim();
    const isRuntime = RUNTIME_PATH_PATTERNS.some((re) => re.test(src));
    if (!isRuntime) return full;
    warnings.push({
      kind: 'runtime-dropped',
      reason: `Skipped <script src="${src}"> (host runtime owns navigation/effects in split mode).`,
    });
    return '';
  });
}

function isSlideAttributes(attrs: string): boolean {
  const match = SLIDE_CLASS_RE.exec(attrs);
  if (!match) return false;
  const classList = (match[2] ?? match[3] ?? '').split(/\s+/);
  return classList.includes('slide');
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

function readSlideLabel(rawSection: ExtractedBlock, index: number): string {
  const dt = DATA_TITLE_RE.exec(rawSection.attributes);
  if (dt) {
    const value = (dt[2] ?? dt[3] ?? '').trim();
    if (value) return value.slice(0, 256);
  }
  const h1 = H1_TEXT_RE.exec(rawSection.innerHtml);
  if (h1) {
    const text = h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 256);
  }
  return `Slide ${index}`;
}

function selectSlides(sections: ExtractedBlock[]): ExtractedSlide[] {
  return sections.map((raw, idx) => {
    const index = idx + 1;
    const label = readSlideLabel(raw, index);
    const slug = slugify(label, `slide-${index}`);
    return {
      slug,
      label,
      attributes: raw.attributes,
      innerHtml: raw.innerHtml,
    };
  });
}

function buildSlidePageHtml(headInner: string, slide: ExtractedSlide): string {
  // Re-emit a self-contained HTML document for the slide. Asset paths stay
  // unchanged because rewriteHtmlAssets in loadDeck.ts resolves them against
  // the slide file's directory, matching the layout we preserve below.
  return `<!doctype html>
<html lang="en">
<head>
${headInner.trim()}
</head>
<body>
<section${slide.attributes}>
${slide.innerHtml}
</section>
</body>
</html>
`;
}

function dropManifestEntry(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    out.set(path, asPlainUint8(bytes));
  }
  return out;
}

function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.substring(0, i);
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

export function splitInlineDeck(input: SplitInput): SplitResult {
  const { rootHtmlPath, entries, sniff } = input;
  const warnings: ConvertWarning[] = [];

  const rootHtml = readBytesAsString(entries, rootHtmlPath);
  if (!rootHtml) {
    throw new Error(`splitInlineDeck: root HTML not found at ${rootHtmlPath}`);
  }

  const headMatch = HEAD_RE.exec(rootHtml);
  const rawHeadInner = headMatch ? headMatch[1] : '';
  const headInner = stripRuntimeScripts(rawHeadInner, warnings);

  // Also scan the full document so body-level runtime scripts surface in the
  // report even though split mode never copies the original <body>.
  RUNTIME_SCRIPT_RE.lastIndex = 0;
  for (let match: RegExpExecArray | null; (match = RUNTIME_SCRIPT_RE.exec(rootHtml)) !== null; ) {
    const src = (match[2] ?? match[3] ?? '').trim();
    if (RUNTIME_PATH_PATTERNS.some((re) => re.test(src))) {
      if (!warnings.some((w) => w.kind === 'runtime-dropped' && w.reason.includes(src))) {
        warnings.push({
          kind: 'runtime-dropped',
          reason: `Skipped <script src="${src}"> (host runtime owns navigation/effects in split mode).`,
        });
      }
    }
  }

  const bodyOpen = BODY_OPEN_RE.exec(rootHtml);
  const bodyClose = BODY_CLOSE_RE.exec(rootHtml);
  const bodyStart = bodyOpen ? bodyOpen.index + bodyOpen[0].length : 0;
  const bodyEnd = bodyClose ? bodyClose.index : rootHtml.length;
  const bodyHtml = rootHtml.substring(bodyStart, bodyEnd);

  const sections = extractBalancedBlocks(bodyHtml, {
    tagName: 'section',
    isMatch: isSlideAttributes,
  });
  const slides = selectSlides(sections);

  if (slides.length === 0) {
    // Caller should fall back to wrap mode; signal by returning zero slides.
    return {
      packEntries: dropManifestEntry(entries),
      slides: [],
      architecture: 'multi-file',
      warnings,
      pageTitle: extractTitle(rootHtml),
      compat: null,
    };
  }

  // Drop the original root HTML so we don't double-render the whole deck.
  const packEntries = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    if (path === rootHtmlPath) continue;
    packEntries.set(path, asPlainUint8(bytes));
  }

  // Place slide pages in the SAME directory as the original root so relative
  // asset paths like `assets/theme.css` continue to resolve. (loadDeck rewrites
  // them against each slide file's URL — keeping the same dir keeps the same
  // base path.)
  const slidesDir = dirnameOf(rootHtmlPath);
  const usedFiles = new Set<string>();
  const manifestSlides: ManifestSlide[] = [];
  // Author scripts surviving into the generated pages need trust. The
  // preserved <head> (post runtime-script strip) is shared by every slide.
  let anyScript = htmlRetainsScript(headInner);

  slides.forEach((slide, idx) => {
    const index = idx + 1;
    const baseSlug = `${pad2(index)}-${slide.slug}`;
    let candidate = joinPath(slidesDir, `${baseSlug}.html`);
    let suffix = 1;
    while (usedFiles.has(candidate) || packEntries.has(candidate)) {
      suffix += 1;
      candidate = joinPath(slidesDir, `${baseSlug}-${suffix}.html`);
    }
    usedFiles.add(candidate);

    const html = buildSlidePageHtml(headInner, slide);
    if (htmlRetainsScript(slide.innerHtml)) anyScript = true;
    packEntries.set(candidate, asPlainUint8(bytesFromString(html)));

    manifestSlides.push({
      index,
      id: `slide-${index}`,
      label: slide.label,
      file: candidate,
      thumbnail: null,
      notes: extractInlineNotes(html) ?? findSlideNotes(entries, candidate),
    });
  });

  void sniff;

  return {
    packEntries,
    slides: manifestSlides,
    architecture: 'multi-file',
    warnings,
    pageTitle: extractTitle(rootHtml),
    compat: anyScript ? splitScriptCompat() : null,
  };
}

function extractTitle(rootHtml: string): string {
  const match = TITLE_RE.exec(rootHtml);
  if (!match) return 'Inline deck';
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 256) || 'Inline deck';
}
