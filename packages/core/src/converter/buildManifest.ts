import type { Manifest, ManifestSlide } from '../deck/types';
import type { RouterManifestEntry, SniffResult } from './sniffer';
import { findSlideNotes } from './speakerNotes';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

interface BuildOptions {
  fileName: string;
  fileLastModified: number;
  fileSize: number;
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function sanitizeManifestId(input: string): string {
  const collapsed = input
    .replace(/\s+/g, '-')
    .replace(/[\/\\]/g, '-')
    .replace(/\.\.+/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '');
  const trimmed = collapsed.slice(0, 128);
  return trimmed || 'sniffed-deck';
}

function readTitle(html: string, fallback: string): string {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) {
    const value = titleMatch[1].replace(/\s+/g, ' ').trim();
    if (value) return value.slice(0, 256);
  }
  return fallback;
}

function readBytes(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) return '';
  return textDecoder.decode(bytes);
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

function makeWrapperSlide(
  rootHtml: string,
  label: string,
  entries: Map<string, Uint8Array>,
): ManifestSlide {
  return {
    index: 1,
    id: 'root',
    label,
    file: rootHtml,
    thumbnail: null,
    notes: findSlideNotes(entries, rootHtml),
  };
}

function buildRouterSlides(
  rootHtml: string,
  routerManifest: RouterManifestEntry[],
  entries: Map<string, Uint8Array>,
): ManifestSlide[] {
  return routerManifest
    .map((entry, idx) => {
      const file = normalizeRelativePath(rootHtml, entry.file);
      if (!entries.has(file)) {
        return null;
      }
      const label = entry.label?.trim() || `Slide ${idx + 1}`;
      const slide: ManifestSlide = {
        index: idx + 1,
        id: `slide-${idx + 1}`,
        label: label.slice(0, 256),
        file,
        thumbnail: null,
        notes: findSlideNotes(entries, file),
      };
      return slide;
    })
    .filter((slide): slide is ManifestSlide => slide !== null);
}

export function buildManifestFromSource(
  sniff: SniffResult,
  entries: Map<string, Uint8Array>,
  options: BuildOptions,
): Manifest {
  const createdAt = isoFromMs(options.fileLastModified || Date.now());
  const baseId = sanitizeManifestId(options.fileName.replace(/\.[^./]+$/, '') || 'sniffed-deck');
  const rootHtml = sniff.rootHtml ?? 'index.html';
  const rootBody = readBytes(entries, rootHtml);
  const title = readTitle(rootBody, baseId);

  const dimensions = { width: 1920, height: 1080 };

  let slides: ManifestSlide[];
  let architecture: Manifest['architecture'];

  switch (sniff.kind) {
    case 'inline-deck':
      slides = [
        makeWrapperSlide(
          rootHtml,
          `Inline deck (${sniff.hints?.inlineSectionCount ?? 0} sections, runtime-managed)`,
          entries,
        ),
      ];
      architecture = 'single-file-html';
      break;
    case 'webcomponent-deck':
      slides = [
        makeWrapperSlide(
          rootHtml,
          `Web Component deck (${sniff.hints?.inlineSectionCount ?? 0} sections, runtime-managed)`,
          entries,
        ),
      ];
      architecture = 'single-file-html';
      break;
    case 'router-html': {
      const routerManifest = sniff.hints?.routerManifest ?? [];
      slides = buildRouterSlides(rootHtml, routerManifest, entries);
      if (slides.length === 0) {
        slides = [makeWrapperSlide(rootHtml, 'Router deck (no resolved slides)', entries)];
        architecture = 'single-file-html';
      } else {
        architecture = 'multi-file';
      }
      break;
    }
    case 'plain-html':
      slides = [makeWrapperSlide(rootHtml, title, entries)];
      architecture = 'single-file-html';
      break;
    default:
      throw new Error(`buildVirtualManifest does not support sniff.kind=${sniff.kind}`);
  }

  return {
    schema: 'slidestage@1.0',
    id: baseId,
    version: '0.0.0',
    title,
    subtitle: null,
    author: null,
    description: `Synthesized by SlideStageLite sniffer (kind=${sniff.kind}).`,
    createdAt,
    updatedAt: createdAt,
    architecture,
    dimensions,
    totalSlides: slides.length,
    slides,
  };
}
