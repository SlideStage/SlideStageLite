import { ZodError } from 'zod';
import { parseManifest } from '../deck/manifestSchema';
import { DeckLoadError, type Manifest, type ManifestSlide, type TrustCapability } from '../deck/types';
import { buildManifestFromSource } from './buildManifest';
import {
  mirrorExternalAssets,
  type MirrorFetcher,
  type MirrorOptions,
  type MirrorPolicy,
  type MirrorResult,
} from './mirrorExternal';
import { packStage } from './pack';
import {
  emptyReport,
  renderReportMarkdown,
  type ConvertMode,
  type ConvertReport,
} from './report';
import { singleHtmlSlide } from './singleHtml';
import { sniffDeck, type SniffKind, type SniffResult } from './sniffer';
import {
  normalizeFolderSource,
  normalizeSource,
  type FolderSource,
  type NormalizedSource,
  type SourceFile,
} from './sources';
import { splitImpress } from './splitImpress';
import { splitInlineDeck } from './splitInlineDeck';
import { splitReveal } from './splitReveal';
import { splitRouter } from './splitRouter';
import { splitWebComponent } from './splitWebComponent';
import { wrapSource } from './wrapSource';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const converterName = 'slidestage-converter';
const converterVersion = '0.1.0';

export interface ManifestOverrides {
  id?: string;
  version?: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface ConvertOptions {
  /** Output mode override. Default is implied by the sniffed source kind. */
  mode?: ConvertMode;
  /** When true, return a Markdown render of the report alongside `stage`. */
  report?: boolean;
  /** Optional manifest overrides applied on top of the synthesized manifest. */
  manifestOverrides?: ManifestOverrides;
  /** Allow re-emitting a `.stage` source (otherwise only `passthrough` is allowed). */
  repackStage?: boolean;
  /** When true, treat warnings as errors and throw. */
  strict?: boolean;
  /**
   * When set, run the offline mirror pass after conversion. The result is
   * baked into the output `.stage` (slide HTML/CSS are statically
   * rewritten, `assets/_mirror/...` is populated, `manifest.offline` is
   * filled in). Set `fetcher: createNetworkFetcher()` to mirror over the
   * real network or supply a test fetcher.
   */
  mirror?: {
    fetcher: MirrorFetcher;
    policy?: MirrorPolicy;
    onProgress?: MirrorOptions['onProgress'];
    toolName?: string;
    toolVersion?: string;
  };
}

export interface ConvertResult {
  /** `.stage` ZIP bytes ready to write to disk or feed to `loadDeck`. */
  stage: Uint8Array;
  /** Final manifest object. */
  manifest: Manifest;
  /** Structured conversion report. */
  report: ConvertReport;
  /** Markdown rendering of the report (only when `options.report === true`). */
  reportMarkdown?: string;
  /** Mirror pass result; present only when `options.mirror` was supplied. */
  mirror?: MirrorResult;
}

const defaultModeBySniff: Record<SniffKind, ConvertMode> = {
  'slidestage@1.0': 'passthrough',
  'inline-deck': 'split',
  'webcomponent-deck': 'split',
  'router-html': 'split',
  // reveal/impress default to "wrap" because their split-mode output drops
  // fragments / 3D camera transitions; users must opt in to split with
  // `--mode split` after acknowledging the lossiness.
  reveal: 'wrap',
  impress: 'wrap',
  'plain-html': 'single',
  ambiguous: 'split',
  empty: 'split',
};

function pickDefaultMode(kind: SniffKind, options: ConvertOptions): ConvertMode {
  return options.mode ?? defaultModeBySniff[kind];
}

function parseStageManifest(entries: Map<string, Uint8Array>): Manifest {
  const bytes = entries.get('manifest.json');
  if (!bytes) {
    throw new DeckLoadError('E_NO_MANIFEST', 'manifest.json is missing from the source package root.');
  }
  let text: string;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    throw new DeckLoadError('E_BAD_MANIFEST', 'manifest.json must be valid UTF-8.');
  }
  try {
    return parseManifest(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      throw new DeckLoadError('E_BAD_MANIFEST', 'manifest.json does not match slidestage@1.0.');
    }
    throw error;
  }
}

function applyOverrides(manifest: Manifest, overrides?: ManifestOverrides): Manifest {
  if (!overrides) return manifest;
  return {
    ...manifest,
    id: overrides.id ?? manifest.id,
    version: overrides.version ?? manifest.version,
    title: overrides.title ?? manifest.title,
    dimensions: {
      width: overrides.width ?? manifest.dimensions.width,
      height: overrides.height ?? manifest.dimensions.height,
    },
  };
}

function attachConversionProvenance(
  manifest: Manifest,
  sniff: SniffResult,
  mode: ConvertMode,
): Manifest {
  if (sniff.kind === 'slidestage@1.0') {
    return manifest;
  }

  return {
    ...manifest,
    provenance: {
      ...(manifest.provenance ?? {}),
      sourceKind: sniff.kind,
      conversionMode: mode,
      ...(sniff.rootHtml ? { sourceEntry: sniff.rootHtml } : {}),
      converter: {
        ...(manifest.provenance?.converter ?? {}),
        name: manifest.provenance?.converter?.name ?? converterName,
        version: manifest.provenance?.converter?.version ?? converterVersion,
      },
    },
  };
}

function copyEntriesForPack(
  entries: Map<string, Uint8Array>,
  excludeManifest = true,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    if (excludeManifest && path === 'manifest.json') continue;
    out.set(path, bytes);
  }
  return out;
}

function gatherAssetPaths(entries: Map<string, Uint8Array>): string[] {
  return Array.from(entries.keys())
    .filter((path) => path !== 'manifest.json')
    .sort();
}

interface DispatchInput {
  normalized: NormalizedSource;
  sniff: SniffResult;
  mode: ConvertMode;
  options: ConvertOptions;
}

interface DispatchOutput {
  manifest: Manifest;
  packEntries: Map<string, Uint8Array>;
  report: ConvertReport;
}

function dispatchPassthrough({ normalized, sniff, mode }: DispatchInput): DispatchOutput {
  const manifest = parseStageManifest(normalized.entries);
  const packEntries = copyEntriesForPack(normalized.entries);
  const report = emptyReport(normalized.sourceName, sniff.kind, mode);
  report.manifestId = manifest.id;
  report.manifestTitle = manifest.title;
  report.totalSlides = manifest.totalSlides;
  report.slides = manifest.slides.map((slide) => ({
    index: slide.index,
    id: slide.id,
    label: slide.label,
    file: slide.file,
  }));
  report.assetsCopied = gatherAssetPaths(packEntries);
  return { manifest, packEntries, report };
}

function notImplemented(kind: SniffKind, mode: ConvertMode): never {
  throw new Error(
    `[converter] Source kind "${kind}" with mode "${mode}" is not yet implemented (lands in a later PR).`,
  );
}

function reportFromSniff(
  normalized: NormalizedSource,
  sniff: SniffResult,
  mode: ConvertMode,
): ConvertReport {
  return emptyReport(normalized.sourceName, sniff.kind, mode);
}

function populateReport(
  report: ConvertReport,
  manifest: Manifest,
  packEntries: Map<string, Uint8Array>,
): void {
  report.manifestId = manifest.id;
  report.manifestTitle = manifest.title;
  report.totalSlides = manifest.totalSlides;
  report.slides = manifest.slides.map((slide) => ({
    index: slide.index,
    id: slide.id,
    label: slide.label,
    file: slide.file,
  }));
  report.assetsCopied = gatherAssetPaths(packEntries);
}

function buildInlineSplitManifest(
  baseManifest: Manifest,
  slides: ManifestSlide[],
  pageTitle: string,
): Manifest {
  return {
    ...baseManifest,
    title: pageTitle || baseManifest.title,
    architecture: 'multi-file',
    totalSlides: slides.length,
    slides,
  };
}

/**
 * Merge the trust metadata a split converter emits when author scripts survive
 * into the generated slides (DSS-CAND-009/010/013/014/015). Without this the
 * deck would run in the base sandbox and the host would never prompt for the
 * capability the author code actually needs.
 */
function applySplitCompat(
  manifest: Manifest,
  compat: { requires: TrustCapability[]; notes: string } | null,
): Manifest {
  if (!compat) return manifest;
  return {
    ...manifest,
    compat: {
      ...(manifest.compat ?? {}),
      requires: compat.requires,
      notes: compat.notes,
    },
  };
}

function buildWrapManifest(
  baseManifest: Manifest,
  slide: ManifestSlide,
  architecture: Manifest['architecture'],
  pageTitle: string,
  compat: { requires: TrustCapability[]; notes: string },
): Manifest {
  return {
    ...baseManifest,
    title: pageTitle || baseManifest.title,
    architecture,
    totalSlides: 1,
    slides: [slide],
    compat: {
      ...(baseManifest.compat ?? {}),
      requires: compat.requires,
      notes: compat.notes,
    },
  };
}

function dispatchInlineDeck(
  input: DispatchInput,
  baseManifest: Manifest,
): DispatchOutput {
  const { normalized, sniff, mode } = input;
  if (!sniff.rootHtml) {
    throw new Error('[converter] inline-deck sniff missing rootHtml.');
  }
  const report = reportFromSniff(normalized, sniff, mode);

  if (mode === 'split') {
    const split = splitInlineDeck({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniff,
    });

    if (split.slides.length === 0) {
      // Fallback to wrap mode when we cannot extract any sections.
      report.warnings.push({
        kind: 'fallback-mode',
        from: 'split',
        to: 'wrap',
        reason: 'no <section class="slide"> blocks were found at the body level',
      });
      const wrap = wrapSource({
        rootHtmlPath: sniff.rootHtml,
        entries: normalized.entries,
        sniffKind: sniff.kind,
      });
      const manifest = buildWrapManifest(baseManifest, wrap.slide, wrap.architecture, wrap.pageTitle, wrap.compat);
      report.mode = 'wrap';
      report.warnings.push(...wrap.warnings);
      populateReport(report, manifest, wrap.packEntries);
      return { manifest, packEntries: wrap.packEntries, report };
    }

    const manifest = applySplitCompat(
      buildInlineSplitManifest(baseManifest, split.slides, split.pageTitle),
      split.compat,
    );
    report.warnings.push(...split.warnings);
    populateReport(report, manifest, split.packEntries);
    return { manifest, packEntries: split.packEntries, report };
  }

  if (mode === 'wrap') {
    const wrap = wrapSource({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniffKind: sniff.kind,
    });
    const manifest = buildWrapManifest(baseManifest, wrap.slide, wrap.architecture, wrap.pageTitle, wrap.compat);
    report.warnings.push(...wrap.warnings);
    populateReport(report, manifest, wrap.packEntries);
    return { manifest, packEntries: wrap.packEntries, report };
  }

  notImplemented(sniff.kind, mode);
}

function dispatchWebComponent(
  input: DispatchInput,
  baseManifest: Manifest,
): DispatchOutput {
  const { normalized, sniff, mode } = input;
  if (!sniff.rootHtml) {
    throw new Error('[converter] webcomponent-deck sniff missing rootHtml.');
  }
  const report = reportFromSniff(normalized, sniff, mode);

  if (mode === 'split') {
    const split = splitWebComponent({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
    });

    if (split.slides.length === 0) {
      report.warnings.push({
        kind: 'fallback-mode',
        from: 'split',
        to: 'wrap',
        reason: 'no <deck-slide> elements were found in the root HTML',
      });
      const wrap = wrapSource({
        rootHtmlPath: sniff.rootHtml,
        entries: normalized.entries,
        sniffKind: sniff.kind,
      });
      const manifest = buildWrapManifest(baseManifest, wrap.slide, wrap.architecture, wrap.pageTitle, wrap.compat);
      report.mode = 'wrap';
      report.warnings.push(...wrap.warnings);
      populateReport(report, manifest, wrap.packEntries);
      return { manifest, packEntries: wrap.packEntries, report };
    }

    const manifest = applySplitCompat(
      {
        ...baseManifest,
        title: split.pageTitle || baseManifest.title,
        architecture: 'multi-file',
        totalSlides: split.slides.length,
        slides: split.slides,
      },
      split.compat,
    );
    report.warnings.push(...split.warnings);
    populateReport(report, manifest, split.packEntries);
    return { manifest, packEntries: split.packEntries, report };
  }

  if (mode === 'wrap') {
    const wrap = wrapSource({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniffKind: sniff.kind,
    });
    const manifest = buildWrapManifest(baseManifest, wrap.slide, wrap.architecture, wrap.pageTitle, wrap.compat);
    report.warnings.push(...wrap.warnings);
    populateReport(report, manifest, wrap.packEntries);
    return { manifest, packEntries: wrap.packEntries, report };
  }

  notImplemented(sniff.kind, mode);
}

function dispatchRouter(
  input: DispatchInput,
  baseManifest: Manifest,
): DispatchOutput {
  const { normalized, sniff, mode } = input;
  if (!sniff.rootHtml) {
    throw new Error('[converter] router-html sniff missing rootHtml.');
  }
  const report = reportFromSniff(normalized, sniff, mode);

  if (mode === 'split') {
    const split = splitRouter({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniff,
    });

    if (split.slides.length === 0) {
      report.warnings.push({
        kind: 'fallback-mode',
        from: 'split',
        to: 'wrap',
        reason: 'window.DECK_MANIFEST resolved zero existing slide files',
      });
      const wrap = wrapSource({
        rootHtmlPath: sniff.rootHtml,
        entries: normalized.entries,
        sniffKind: sniff.kind,
      });
      const manifest = buildWrapManifest(baseManifest, wrap.slide, wrap.architecture, wrap.pageTitle, wrap.compat);
      report.mode = 'wrap';
      report.warnings.push(...split.warnings, ...wrap.warnings);
      populateReport(report, manifest, wrap.packEntries);
      return { manifest, packEntries: wrap.packEntries, report };
    }

    const manifest = applySplitCompat(
      {
        ...baseManifest,
        title: split.pageTitle || baseManifest.title,
        architecture: 'multi-file',
        totalSlides: split.slides.length,
        slides: split.slides,
      },
      split.compat,
    );
    report.warnings.push(...split.warnings);
    populateReport(report, manifest, split.packEntries);
    return { manifest, packEntries: split.packEntries, report };
  }

  if (mode === 'wrap') {
    const wrap = wrapSource({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniffKind: sniff.kind,
    });
    const manifest = buildWrapManifest(baseManifest, wrap.slide, wrap.architecture, wrap.pageTitle, wrap.compat);
    report.warnings.push(...wrap.warnings);
    populateReport(report, manifest, wrap.packEntries);
    return { manifest, packEntries: wrap.packEntries, report };
  }

  notImplemented(sniff.kind, mode);
}

function dispatchReveal(
  input: DispatchInput,
  baseManifest: Manifest,
): DispatchOutput {
  const { normalized, sniff, mode } = input;
  if (!sniff.rootHtml) {
    throw new Error('[converter] reveal sniff missing rootHtml.');
  }
  const report = reportFromSniff(normalized, sniff, mode);

  if (mode === 'split') {
    const split = splitReveal({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniff,
    });

    if (split.slides.length === 0) {
      report.warnings.push({
        kind: 'fallback-mode',
        from: 'split',
        to: 'wrap',
        reason: 'no reveal.js <section> children resolved (.reveal > .slides empty)',
      });
      const wrap = wrapSource({
        rootHtmlPath: sniff.rootHtml,
        entries: normalized.entries,
        sniffKind: sniff.kind,
      });
      const manifest = buildWrapManifest(
        baseManifest,
        wrap.slide,
        wrap.architecture,
        wrap.pageTitle,
        wrap.compat,
      );
      report.mode = 'wrap';
      report.warnings.push(...split.warnings, ...wrap.warnings);
      populateReport(report, manifest, wrap.packEntries);
      return { manifest, packEntries: wrap.packEntries, report };
    }

    const manifest = applySplitCompat(
      buildInlineSplitManifest(baseManifest, split.slides, split.pageTitle),
      split.compat,
    );
    report.warnings.push(...split.warnings);
    populateReport(report, manifest, split.packEntries);
    return { manifest, packEntries: split.packEntries, report };
  }

  if (mode === 'wrap') {
    const wrap = wrapSource({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniffKind: sniff.kind,
    });
    const manifest = buildWrapManifest(
      baseManifest,
      wrap.slide,
      wrap.architecture,
      wrap.pageTitle,
      wrap.compat,
    );
    report.warnings.push(...wrap.warnings);
    populateReport(report, manifest, wrap.packEntries);
    return { manifest, packEntries: wrap.packEntries, report };
  }

  notImplemented(sniff.kind, mode);
}

function dispatchImpress(
  input: DispatchInput,
  baseManifest: Manifest,
): DispatchOutput {
  const { normalized, sniff, mode } = input;
  if (!sniff.rootHtml) {
    throw new Error('[converter] impress sniff missing rootHtml.');
  }
  const report = reportFromSniff(normalized, sniff, mode);

  if (mode === 'split') {
    const split = splitImpress({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniff,
    });

    if (split.slides.length === 0) {
      report.warnings.push({
        kind: 'fallback-mode',
        from: 'split',
        to: 'wrap',
        reason: 'no impress.js <div class="step"> children resolved inside #impress',
      });
      const wrap = wrapSource({
        rootHtmlPath: sniff.rootHtml,
        entries: normalized.entries,
        sniffKind: sniff.kind,
      });
      const manifest = buildWrapManifest(
        baseManifest,
        wrap.slide,
        wrap.architecture,
        wrap.pageTitle,
        wrap.compat,
      );
      report.mode = 'wrap';
      report.warnings.push(...split.warnings, ...wrap.warnings);
      populateReport(report, manifest, wrap.packEntries);
      return { manifest, packEntries: wrap.packEntries, report };
    }

    const manifest = applySplitCompat(
      buildInlineSplitManifest(baseManifest, split.slides, split.pageTitle),
      split.compat,
    );
    report.warnings.push(...split.warnings);
    populateReport(report, manifest, split.packEntries);
    return { manifest, packEntries: split.packEntries, report };
  }

  if (mode === 'wrap') {
    const wrap = wrapSource({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
      sniffKind: sniff.kind,
    });
    const manifest = buildWrapManifest(
      baseManifest,
      wrap.slide,
      wrap.architecture,
      wrap.pageTitle,
      wrap.compat,
    );
    report.warnings.push(...wrap.warnings);
    populateReport(report, manifest, wrap.packEntries);
    return { manifest, packEntries: wrap.packEntries, report };
  }

  notImplemented(sniff.kind, mode);
}

function dispatchPlainHtml(
  input: DispatchInput,
  baseManifest: Manifest,
): DispatchOutput {
  const { normalized, sniff, mode } = input;
  if (!sniff.rootHtml) {
    throw new Error('[converter] plain-html sniff missing rootHtml.');
  }
  const report = reportFromSniff(normalized, sniff, mode);

  if (mode === 'single' || mode === 'wrap') {
    const single = singleHtmlSlide({
      rootHtmlPath: sniff.rootHtml,
      entries: normalized.entries,
    });
    const manifest: Manifest = {
      ...baseManifest,
      title: single.pageTitle || baseManifest.title,
      description: single.description ?? baseManifest.description,
      architecture: 'single-file-html',
      totalSlides: 1,
      slides: [single.slide],
      ...(single.compat
        ? {
            compat: {
              ...(baseManifest.compat ?? {}),
              requires: single.compat.requires,
              notes: single.compat.notes,
            },
          }
        : {}),
    };
    report.warnings.push(...single.warnings);
    populateReport(report, manifest, single.packEntries);
    return { manifest, packEntries: single.packEntries, report };
  }

  notImplemented(sniff.kind, mode);
}

function dispatch(input: DispatchInput): DispatchOutput {
  const { sniff, mode, normalized, options } = input;

  switch (sniff.kind) {
    case 'slidestage@1.0':
      if (mode === 'passthrough') {
        return dispatchPassthrough(input);
      }
      if (!options.repackStage) {
        throw new Error(
          `[converter] slidestage@1.0 source can only be converted in "passthrough" mode unless --repack is set.`,
        );
      }
      return notImplemented(sniff.kind, mode);

    case 'empty':
      throw new DeckLoadError(
        'E_NO_ENTRY_FOUND',
        'No HTML or manifest.json was found inside the source.',
      );

    case 'ambiguous':
      throw new DeckLoadError(
        'E_AMBIGUOUS_PACKAGE',
        'Multiple top-level HTML files were found and no index.html disambiguates the deck root.',
      );

    case 'inline-deck': {
      const baseManifest = buildManifestFromSource(sniff, normalized.entries, {
        fileName: normalized.sourceName,
        fileSize: normalized.rawBytes.byteLength,
        fileLastModified: normalized.sourceLastModified,
      });
      return dispatchInlineDeck(input, baseManifest);
    }

    case 'webcomponent-deck': {
      const baseManifest = buildManifestFromSource(sniff, normalized.entries, {
        fileName: normalized.sourceName,
        fileSize: normalized.rawBytes.byteLength,
        fileLastModified: normalized.sourceLastModified,
      });
      return dispatchWebComponent(input, baseManifest);
    }

    case 'router-html': {
      const baseManifest = buildManifestFromSource(sniff, normalized.entries, {
        fileName: normalized.sourceName,
        fileSize: normalized.rawBytes.byteLength,
        fileLastModified: normalized.sourceLastModified,
      });
      return dispatchRouter(input, baseManifest);
    }

    case 'reveal': {
      const baseManifest = buildManifestFromSource(sniff, normalized.entries, {
        fileName: normalized.sourceName,
        fileSize: normalized.rawBytes.byteLength,
        fileLastModified: normalized.sourceLastModified,
      });
      return dispatchReveal(input, baseManifest);
    }

    case 'impress': {
      const baseManifest = buildManifestFromSource(sniff, normalized.entries, {
        fileName: normalized.sourceName,
        fileSize: normalized.rawBytes.byteLength,
        fileLastModified: normalized.sourceLastModified,
      });
      return dispatchImpress(input, baseManifest);
    }

    case 'plain-html': {
      const baseManifest = buildManifestFromSource(sniff, normalized.entries, {
        fileName: normalized.sourceName,
        fileSize: normalized.rawBytes.byteLength,
        fileLastModified: normalized.sourceLastModified,
      });
      return dispatchPlainHtml(input, baseManifest);
    }

    default: {
      const exhaustive: never = sniff.kind;
      throw new Error(`[converter] Unsupported sniff kind: ${String(exhaustive)}`);
    }
  }
}

async function convertNormalized(
  normalized: NormalizedSource,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const sniff = sniffDeck(normalized.entries);
  const mode = pickDefaultMode(sniff.kind, options);

  const { manifest, packEntries, report } = dispatch({
    normalized,
    sniff,
    mode,
    options,
  });

  const finalManifest = attachConversionProvenance(
    applyOverrides(manifest, options.manifestOverrides),
    sniff,
    report.mode,
  );
  if (finalManifest !== manifest) {
    report.manifestId = finalManifest.id;
    report.manifestTitle = finalManifest.title;
  }

  let resolvedManifest = finalManifest;
  let resolvedEntries = packEntries;
  let mirrorResult: MirrorResult | undefined;
  if (options.mirror) {
    mirrorResult = await mirrorExternalAssets(
      { entries: packEntries, manifest: finalManifest },
      {
        fetcher: options.mirror.fetcher,
        policy: options.mirror.policy,
        onProgress: options.mirror.onProgress,
        toolName: options.mirror.toolName,
        toolVersion: options.mirror.toolVersion,
      },
    );
    resolvedManifest = mirrorResult.manifest;
    resolvedEntries = mirrorResult.entries;
    if (mirrorResult.stats.skipped > 0) {
      for (const skip of mirrorResult.offline.skippedUrls) {
        report.warnings.push({
          kind: 'mirror-skipped',
          url: skip.url,
          reason: skip.reason,
          ...(skip.detail ? { detail: skip.detail } : {}),
        });
      }
    }
  }

  if (options.strict && report.warnings.length > 0) {
    throw new Error(
      `[converter] Conversion produced ${report.warnings.length} warning(s) and --strict is set.`,
    );
  }

  const stage = packStage(resolvedManifest, resolvedEntries);
  const result: ConvertResult = {
    stage,
    manifest: resolvedManifest,
    report,
  };

  if (options.report) {
    result.reportMarkdown = renderReportMarkdown(report);
  }

  if (mirrorResult) {
    result.mirror = mirrorResult;
  }

  return result;
}

export async function convertSource(
  source: SourceFile,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  return convertNormalized(normalizeSource(source), options);
}

/**
 * Pack a folder-shaped input — keyed by package-relative paths — into a
 * `.stage`. Use this entry point when the source comes from a directory
 * tree (CLI `pack <folder>`) or from a multi-file browser drop (SPA folder
 * picker / `webkitdirectory` / drag-and-drop).
 *
 * Unlike {@link convertSource}, this bypasses ZIP decompression and the
 * package-size cap: the caller already paid the cost of reading the bytes
 * and is responsible for any size limits they want to enforce.
 */
export async function convertFolderSource(
  source: FolderSource,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  return convertNormalized(normalizeFolderSource(source), options);
}

export { sniffDeck } from './sniffer';
export { buildManifestFromSource } from './buildManifest';
export { safeUnzipSync, type UnzipBudget } from '../deck/safeUnzip';
export { packStage } from './pack';
export { renderReportMarkdown } from './report';
export { shouldSkipFolderPath, DEFAULT_FOLDER_SKIP_PATTERNS } from './folderFilter';
export {
  mirrorExternalAssets,
  createNetworkFetcher,
  DEFAULT_MIRROR_POLICY,
  MIRROR_TOOL_NAME,
  MIRROR_TOOL_VERSION,
  extractExternalRefsFromHtml,
  extractExternalRefsFromCss,
} from './mirrorExternal';
export type {
  MirrorFetcher,
  MirrorFetchResult,
  MirrorFetchSuccess,
  MirrorFetchFailure,
  MirrorOptions,
  MirrorPolicy,
  MirrorProgress,
  MirrorResult,
  NetworkFetcherOptions,
} from './mirrorExternal';
export type { SourceFile, FolderSource, NormalizedSource } from './sources';
export type { ConvertMode, ConvertReport, ConvertWarning } from './report';
