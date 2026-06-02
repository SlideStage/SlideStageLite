import { DeckLoadError } from '../deck/types';
import { normalizePackagePath } from '../deck/pathSafety';
import { safeUnzipSync } from '../deck/safeUnzip';
import { shouldSkipFolderPath } from './folderFilter';

export interface SourceFile {
  /** File bytes. The converter never mutates this buffer. */
  bytes: Uint8Array;
  /** Original file name including extension. Used to pick the read strategy. */
  name: string;
  /** Last-modified epoch ms. Defaults to `Date.now()`. */
  lastModified?: number;
}

export interface FolderSource {
  /**
   * Entries keyed by package-relative paths. Callers are responsible for
   * supplying forward-slash paths; the normalizer enforces it but also
   * applies the {@link shouldSkipFolderPath} filter so producers can hand
   * us a development tree without scrubbing the directory first.
   */
  entries: Map<string, Uint8Array> | Iterable<readonly [string, Uint8Array]>;
  /** Human-friendly source identifier (typically the folder name). */
  name: string;
  /**
   * Last-modified epoch ms used to seed manifest.createdAt / .updatedAt.
   * Defaults to `Date.now()`.
   */
  lastModified?: number;
}

export interface NormalizedSource {
  /** Bag of files keyed by normalized package paths (forward slashes, no `..`). */
  entries: Map<string, Uint8Array>;
  /** Original file name carried through for manifest defaulting and reporting. */
  sourceName: string;
  /** Bytes of the original file. Useful for hashing / fingerprinting. */
  rawBytes: Uint8Array;
  /** Last-modified epoch ms (defaults to `Date.now()`). */
  sourceLastModified: number;
}

const maxPackageBytes = 200 * 1024 * 1024;
const maxDecompressedBytes = 1024 * 1024 * 1024;
const maxEntryBytes = 100 * 1024 * 1024;

function normalizeEntries(raw: Record<string, Uint8Array>): Map<string, Uint8Array> {
  let total = 0;
  const entries = new Map<string, Uint8Array>();

  for (const [rawPath, bytes] of Object.entries(raw)) {
    if (rawPath.endsWith('/')) continue;

    const path = normalizePackagePath(rawPath);
    if (bytes.byteLength > maxEntryBytes) {
      throw new DeckLoadError('E_TOO_LARGE', `Source entry is too large: ${path}`);
    }

    total += bytes.byteLength;
    if (total > maxDecompressedBytes) {
      throw new DeckLoadError('E_TOO_LARGE', 'Source exceeds the decompressed size limit.');
    }
    entries.set(path, bytes);
  }

  return entries;
}

export function normalizeSource(source: SourceFile): NormalizedSource {
  if (source.bytes.byteLength > maxPackageBytes) {
    throw new DeckLoadError('E_TOO_LARGE', 'Source exceeds the package size limit.');
  }

  const isHtml = /\.html?$/i.test(source.name);
  let entries: Map<string, Uint8Array>;

  if (isHtml) {
    // Single-HTML source: present it as a one-entry virtual archive.
    entries = new Map([['index.html', source.bytes]]);
  } else {
    let raw: Record<string, Uint8Array>;
    try {
      // Budget-aware unzip: reject decompression bombs before materializing
      // the archive in memory (CWE-409 / CWE-400).
      raw = safeUnzipSync(source.bytes, {
        maxEntryBytes,
        maxTotalBytes: maxDecompressedBytes,
      });
    } catch (error) {
      if (error instanceof DeckLoadError) {
        throw error;
      }
      throw new DeckLoadError(
        'E_NOT_ZIP',
        'The selected source is not a readable .html or .zip / .stage archive.',
      );
    }
    entries = normalizeEntries(raw);
  }

  return {
    entries,
    sourceName: source.name,
    rawBytes: source.bytes,
    sourceLastModified: source.lastModified ?? Date.now(),
  };
}

/**
 * Walk a folder-shaped input into the same `NormalizedSource` the rest of
 * the pipeline consumes. Skips dev-tree noise via
 * {@link shouldSkipFolderPath} and **does not enforce package-size caps**
 * (the loader will reject oversize outputs separately).
 *
 * The `rawBytes` field on the returned object is an empty buffer; callers
 * who need to hash the input should walk the entries themselves.
 */
export function normalizeFolderSource(source: FolderSource): NormalizedSource {
  const entries = new Map<string, Uint8Array>();
  const iterable: Iterable<readonly [string, Uint8Array]> =
    source.entries instanceof Map ? source.entries.entries() : source.entries;

  for (const [rawPath, bytes] of iterable) {
    if (typeof rawPath !== 'string' || rawPath.length === 0) continue;
    if (rawPath.endsWith('/')) continue;
    if (shouldSkipFolderPath(rawPath)) continue;
    const path = normalizePackagePath(rawPath);
    entries.set(path, bytes);
  }

  if (entries.size === 0) {
    throw new DeckLoadError(
      'E_NO_ENTRY_FOUND',
      'Folder source contains no files after filtering. Drop or pass at least one HTML page.',
    );
  }

  return {
    entries,
    sourceName: source.name,
    rawBytes: new Uint8Array(0),
    sourceLastModified: source.lastModified ?? Date.now(),
  };
}
