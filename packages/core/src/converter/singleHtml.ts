import type { Manifest, ManifestSlide, TrustCapability } from '../deck/types';
import { asPlainUint8 } from './pack';
import type { ConvertWarning } from './report';
import { findSlideNotes } from './speakerNotes';

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_DESCRIPTION_RE = /<meta\s+[^>]*name\s*=\s*("description"|'description')[^>]*content\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/i;
const ANY_SCRIPT_RE = /<script\b[^>]*>/i;

const SCRIPT_TRUST_CAPABILITIES: TrustCapability[] = [
  'same-origin-storage',
  'broadcast-channel',
];

export interface SingleHtmlInput {
  rootHtmlPath: string;
  entries: Map<string, Uint8Array>;
}

export interface SingleHtmlResult {
  packEntries: Map<string, Uint8Array>;
  slide: ManifestSlide;
  architecture: Manifest['architecture'];
  warnings: ConvertWarning[];
  pageTitle: string;
  description: string | null;
  /** Populated only when the source contains `<script>` tags. */
  compat?: { requires: TrustCapability[]; notes: string };
}

function readBytesAsString(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) return '';
  return textDecoder.decode(bytes);
}

function extractTitle(rootHtml: string): string {
  const head = HEAD_RE.exec(rootHtml);
  if (!head) return 'Plain HTML page';
  const title = TITLE_RE.exec(head[1]);
  if (!title) return 'Plain HTML page';
  return title[1].replace(/\s+/g, ' ').trim().slice(0, 256) || 'Plain HTML page';
}

function extractDescription(rootHtml: string): string | null {
  const head = HEAD_RE.exec(rootHtml);
  if (!head) return null;
  const meta = META_DESCRIPTION_RE.exec(head[1]);
  if (!meta) return null;
  const value = (meta[3] ?? meta[4] ?? '').replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 512) : null;
}

export function singleHtmlSlide(input: SingleHtmlInput): SingleHtmlResult {
  const { rootHtmlPath, entries } = input;
  const warnings: ConvertWarning[] = [];

  const rootHtml = readBytesAsString(entries, rootHtmlPath);
  if (!rootHtml) {
    throw new Error(`singleHtmlSlide: root HTML not found at ${rootHtmlPath}`);
  }

  const packEntries = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    packEntries.set(path, asPlainUint8(bytes));
  }

  const pageTitle = extractTitle(rootHtml);
  const description = extractDescription(rootHtml);

  const slide: ManifestSlide = {
    index: 1,
    id: 'root',
    label: pageTitle.slice(0, 256),
    file: rootHtmlPath,
    thumbnail: null,
    notes: findSlideNotes(entries, rootHtmlPath),
  };

  const hasScript = ANY_SCRIPT_RE.test(rootHtml);
  if (!hasScript) {
    return {
      packEntries,
      slide,
      architecture: 'single-file-html',
      warnings,
      pageTitle,
      description,
    };
  }

  warnings.push({
    kind: 'note',
    message:
      'Source HTML contains a <script> tag; populating compat.requires so the host can prompt the user for trust before running the script in PR-D4.',
  });

  return {
    packEntries,
    slide,
    architecture: 'single-file-html',
    warnings,
    pageTitle,
    description,
    compat: {
      requires: [...SCRIPT_TRUST_CAPABILITIES],
      notes:
        'Plain-HTML source ships an inline <script>. The converter wraps it as a single slide; the host must grant the listed trust capabilities (PR-D4) before the script runs inside the iframe.',
    },
  };
}
