import type { Manifest, ManifestSlide } from '../deck/types';
import { extractBalancedBlocks, type ExtractedBlock } from './htmlBlocks';
import { asPlainUint8, bytesFromString } from './pack';
import type { ConvertWarning } from './report';
import { htmlRetainsScript, splitScriptCompat, type SplitScriptCompat } from './splitCompat';
import { extractInlineNotes, findSlideNotes } from './speakerNotes';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const DATA_TITLE_RE = /\bdata-title\s*=\s*("([^"]*)"|'([^']*)')/i;
const H1_TEXT_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const RUNTIME_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>\s*<\/script\s*>/gi;
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
const DECK_STAGE_SRC_PATTERNS = [
  /deck-stage(?:\.bundle)?\.js(?:[?#].*)?$/i,
  /deck-stage(?:\.bundle)?\.min\.js(?:[?#].*)?$/i,
];
export interface SplitWcInput {
  rootHtmlPath: string;
  entries: Map<string, Uint8Array>;
}

export interface SplitWcResult {
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

function stripRuntimeRefs(html: string, warnings: ConvertWarning[]): string {
  // Strip <script src="…deck-stage.js"></script>.
  let output = html.replace(RUNTIME_SCRIPT_RE, (full, _quoted, dq, sq) => {
    const src = (dq ?? sq ?? '').trim();
    const isStageScript = DECK_STAGE_SRC_PATTERNS.some((re) => re.test(src));
    if (!isStageScript) return full;
    warnings.push({
      kind: 'runtime-dropped',
      reason: `Skipped <script src="${src}"> (custom-element registration is not re-run in split mode).`,
    });
    return '';
  });

  // Strip inline <script>customElements.define('deck-stage', …)</script>.
  output = output.replace(INLINE_SCRIPT_RE, (full, body) => {
    if (!body || !/customElements\s*\.\s*define\s*\(\s*['"](deck-stage|deck-slide)['"]/.test(body)) {
      return full;
    }
    warnings.push({
      kind: 'runtime-dropped',
      reason: 'Skipped inline customElements.define for <deck-stage>/<deck-slide>.',
    });
    return '';
  });

  return output;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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

function readSlideLabel(raw: ExtractedBlock, index: number): string {
  const dt = DATA_TITLE_RE.exec(raw.attributes);
  if (dt) {
    const value = (dt[2] ?? dt[3] ?? '').trim();
    if (value) return value.slice(0, 256);
  }
  const h1 = H1_TEXT_RE.exec(raw.innerHtml);
  if (h1) {
    const text = h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 256);
  }
  return `Slide ${index}`;
}

function selectSlides(blocks: ExtractedBlock[]): ExtractedSlide[] {
  return blocks.map((raw, idx) => {
    const index = idx + 1;
    const label = readSlideLabel(raw, index);
    const slug = slugify(label, `slide-${index}`);
    return { slug, label, attributes: raw.attributes, innerHtml: raw.innerHtml };
  });
}

function buildSlidePageHtml(headInner: string, slide: ExtractedSlide): string {
  // Re-emit each <deck-slide> as a self-contained page. We deliberately keep
  // the original `<deck-slide …>` element so any CSS authored against that
  // selector continues to apply, even though there is no <deck-stage> wrapper
  // (the host runtime owns layout in split mode).
  return `<!doctype html>
<html lang="en">
<head>
${headInner.trim()}
</head>
<body>
<deck-slide${slide.attributes}>
${slide.innerHtml}
</deck-slide>
</body>
</html>
`;
}

function extractTitle(rootHtml: string): string {
  const head = HEAD_RE.exec(rootHtml);
  if (!head) return 'Web Component deck';
  const title = TITLE_RE.exec(head[1]);
  if (!title) return 'Web Component deck';
  return title[1].replace(/\s+/g, ' ').trim().slice(0, 256) || 'Web Component deck';
}

function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.substring(0, i);
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

export function splitWebComponent(input: SplitWcInput): SplitWcResult {
  const { rootHtmlPath, entries } = input;
  const warnings: ConvertWarning[] = [];

  const rootHtml = readBytesAsString(entries, rootHtmlPath);
  if (!rootHtml) {
    throw new Error(`splitWebComponent: root HTML not found at ${rootHtmlPath}`);
  }

  const headMatch = HEAD_RE.exec(rootHtml);
  const rawHeadInner = headMatch ? headMatch[1] : '';
  const headInner = stripRuntimeRefs(rawHeadInner, warnings);

  // Surface every runtime/register script in the body too — split mode never
  // copies the original body so these would otherwise vanish silently.
  void stripRuntimeRefs(rootHtml, warnings);

  const blocks = extractBalancedBlocks(rootHtml, { tagName: 'deck-slide' });

  if (blocks.length === 0) {
    return {
      packEntries: copyEntriesExcludingManifest(entries),
      slides: [],
      architecture: 'multi-file',
      warnings,
      pageTitle: extractTitle(rootHtml),
      compat: null,
    };
  }

  const slides = selectSlides(blocks);

  const packEntries = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    if (path === rootHtmlPath) continue;
    packEntries.set(path, asPlainUint8(bytes));
  }

  const slideDir = dirnameOf(rootHtmlPath);
  const usedFiles = new Set<string>();
  const manifestSlides: ManifestSlide[] = [];
  // Author scripts surviving into the generated pages need trust. The
  // preserved <head> (post runtime-script strip) is shared by every slide.
  let anyScript = htmlRetainsScript(headInner);

  slides.forEach((slide, idx) => {
    const index = idx + 1;
    const baseSlug = `${pad2(index)}-${slide.slug}`;
    let candidate = joinPath(slideDir, `${baseSlug}.html`);
    let suffix = 1;
    while (usedFiles.has(candidate) || packEntries.has(candidate)) {
      suffix += 1;
      candidate = joinPath(slideDir, `${baseSlug}-${suffix}.html`);
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

  return {
    packEntries,
    slides: manifestSlides,
    architecture: 'multi-file',
    warnings,
    pageTitle: extractTitle(rootHtml),
    compat: anyScript ? splitScriptCompat() : null,
  };
}

function copyEntriesExcludingManifest(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    out.set(path, asPlainUint8(bytes));
  }
  return out;
}
