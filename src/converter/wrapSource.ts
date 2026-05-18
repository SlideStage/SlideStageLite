import type { Manifest, ManifestSlide, TrustCapability } from '../deck/types';
import { asPlainUint8 } from './pack';
import type { ConvertWarning } from './report';
import type { SniffKind } from './sniffer';

const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const textDecoder = new TextDecoder('utf-8', { fatal: false });

const DEFAULT_TRUST_REQUIRES: TrustCapability[] = [
  'same-origin-storage',
  'broadcast-channel',
  'window-open',
];

export interface WrapInput {
  rootHtmlPath: string;
  entries: Map<string, Uint8Array>;
  sniffKind: SniffKind;
  /** Optional human-readable label for the single wrapper slide. */
  label?: string;
  /** Optional override for the trust capabilities advertised by the deck. */
  requires?: TrustCapability[];
}

export interface WrapResult {
  packEntries: Map<string, Uint8Array>;
  slide: ManifestSlide;
  architecture: Manifest['architecture'];
  warnings: ConvertWarning[];
  pageTitle: string;
  compat: {
    requires: TrustCapability[];
    notes: string;
  };
}

function defaultLabel(kind: SniffKind, fallback: string): string {
  switch (kind) {
    case 'inline-deck':
      return `${fallback} (inline-deck, runtime-managed)`;
    case 'webcomponent-deck':
      return `${fallback} (web component deck, runtime-managed)`;
    case 'router-html':
      return `${fallback} (router deck, runtime-managed)`;
    default:
      return fallback;
  }
}

function extractTitle(rootHtml: string): string {
  const head = HEAD_RE.exec(rootHtml);
  if (!head) return 'Wrapped deck';
  const title = TITLE_RE.exec(head[1]);
  if (!title) return 'Wrapped deck';
  return title[1].replace(/\s+/g, ' ').trim().slice(0, 256) || 'Wrapped deck';
}

export function wrapSource(input: WrapInput): WrapResult {
  const { rootHtmlPath, entries, sniffKind, label, requires } = input;
  const warnings: ConvertWarning[] = [];

  const rootBytes = entries.get(rootHtmlPath);
  if (!rootBytes) {
    throw new Error(`wrapSource: root HTML not found at ${rootHtmlPath}`);
  }

  const rootHtml = textDecoder.decode(rootBytes);
  const pageTitle = extractTitle(rootHtml);

  const packEntries = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    packEntries.set(path, asPlainUint8(bytes));
  }

  const slide: ManifestSlide = {
    index: 1,
    id: 'root',
    label: (label ?? defaultLabel(sniffKind, pageTitle)).slice(0, 256),
    file: rootHtmlPath,
    thumbnail: null,
    notes: null,
  };

  const trustRequires = requires && requires.length > 0 ? [...requires] : [...DEFAULT_TRUST_REQUIRES];
  const notes =
    `Original ${sniffKind} HTML preserved as the single wrapper slide. ` +
    `This deck depends on its own in-page runtime (script execution and storage); ` +
    `the host must grant the listed trust capabilities to render correctly.`;

  warnings.push({
    kind: 'note',
    message:
      `Wrap mode keeps the original ${sniffKind} HTML intact. ` +
      `Audience will need to grant trust (E_TRUST_REQUIRED) when PR-D4 lands; ` +
      `until then the iframe sandbox blocks the original runtime from doing same-origin work.`,
  });

  return {
    packEntries,
    slide,
    architecture: 'single-file-html',
    warnings,
    pageTitle,
    compat: {
      requires: trustRequires,
      notes,
    },
  };
}
