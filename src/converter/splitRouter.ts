import type { Manifest, ManifestSlide } from '../deck/types';
import { asPlainUint8 } from './pack';
import type { ConvertWarning } from './report';
import type { RouterManifestEntry, SniffResult } from './sniffer';

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const RELATIVE_PARENT_REF_RE = /(href|src)\s*=\s*("(\.\.\/[^"]+)"|'(\.\.\/[^']+)')/gi;

export interface SplitRouterInput {
  rootHtmlPath: string;
  entries: Map<string, Uint8Array>;
  sniff: SniffResult;
}

export interface SplitRouterResult {
  packEntries: Map<string, Uint8Array>;
  slides: ManifestSlide[];
  architecture: Manifest['architecture'];
  warnings: ConvertWarning[];
  pageTitle: string;
}

function readBytesAsString(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) return '';
  return textDecoder.decode(bytes);
}

function extractTitle(rootHtml: string): string {
  const head = HEAD_RE.exec(rootHtml);
  if (!head) return 'Router deck';
  const title = TITLE_RE.exec(head[1]);
  if (!title) return 'Router deck';
  return title[1].replace(/\s+/g, ' ').trim().slice(0, 256) || 'Router deck';
}

function normalizeRelativePath(rootHtml: string, reference: string): string {
  const baseParts = rootHtml.split('/');
  baseParts.pop();

  const output = [...baseParts];
  for (const part of reference.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (output.length === 0) return reference;
      output.pop();
      continue;
    }
    output.push(part);
  }
  return output.join('/');
}

function scanParentRefs(slideHtml: string, slidePath: string, warnings: ConvertWarning[]): void {
  RELATIVE_PARENT_REF_RE.lastIndex = 0;
  const seen = new Set<string>();
  for (let m: RegExpExecArray | null; (m = RELATIVE_PARENT_REF_RE.exec(slideHtml)) !== null; ) {
    const ref = (m[3] ?? m[4] ?? '').trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    warnings.push({
      kind: 'note',
      message:
        `Slide \`${slidePath}\` references \`${ref}\` (parent-directory traversal). ` +
        `Keep the asset siblings in the source ZIP so loadDeck's path-safety check still resolves the file inside the package.`,
    });
  }
}

export function splitRouter(input: SplitRouterInput): SplitRouterResult {
  const { rootHtmlPath, entries, sniff } = input;
  const warnings: ConvertWarning[] = [];

  const rootHtml = readBytesAsString(entries, rootHtmlPath);
  if (!rootHtml) {
    throw new Error(`splitRouter: root HTML not found at ${rootHtmlPath}`);
  }

  const pageTitle = extractTitle(rootHtml);
  const routerEntries: RouterManifestEntry[] = sniff.hints?.routerManifest ?? [];

  if (routerEntries.length === 0) {
    return {
      packEntries: copyExceptManifest(entries),
      slides: [],
      architecture: 'multi-file',
      warnings,
      pageTitle,
    };
  }

  const packEntries = copyExceptManifest(entries);
  const slides: ManifestSlide[] = [];
  let kept = 0;

  routerEntries.forEach((entry, idx) => {
    const resolved = normalizeRelativePath(rootHtmlPath, entry.file);
    if (!entries.has(resolved)) {
      warnings.push({ kind: 'router-missing-entry', file: entry.file });
      return;
    }

    kept += 1;
    const slideHtml = readBytesAsString(entries, resolved);
    scanParentRefs(slideHtml, resolved, warnings);

    const label = (entry.label?.trim() || `Slide ${idx + 1}`).slice(0, 256);
    slides.push({
      index: kept,
      id: `slide-${kept}`,
      label,
      file: resolved,
      thumbnail: null,
      notes: null,
    });
  });

  // Drop the route-only root HTML — keeping it would let users navigate to a
  // loading page that does not render under Lite. The slide entries already
  // point directly at the per-slide files.
  packEntries.delete(rootHtmlPath);

  return {
    packEntries,
    slides,
    architecture: 'multi-file',
    warnings,
    pageTitle,
  };
}

function copyExceptManifest(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    out.set(path, asPlainUint8(bytes));
  }
  return out;
}
