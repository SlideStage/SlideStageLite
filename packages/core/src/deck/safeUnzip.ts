import { unzipSync, type UnzipFileInfo } from 'fflate';
import { DeckLoadError } from './types';

export interface UnzipBudget {
  /** Max declared uncompressed bytes allowed for any single entry. */
  maxEntryBytes: number;
  /** Max declared uncompressed bytes summed across all kept entries. */
  maxTotalBytes: number;
}

/**
 * Decompress a ZIP archive with a hard budget enforced *before* any entry is
 * inflated — the defense against decompression bombs (CWE-409 / CWE-400).
 *
 * `fflate.unzipSync` invokes the `filter` callback for every member with the
 * size fields parsed from the central directory header (`originalSize` =
 * declared uncompressed length) *before* it touches the compressed payload,
 * and it preallocates the inflate output buffer to exactly `originalSize`,
 * truncating any deflate stream that tries to exceed it. Budgeting on
 * `originalSize` therefore caps both the per-entry allocation and the
 * realistic bomb vector: a tiny archive that declares gigabytes of output is
 * rejected up front instead of materializing every entry in memory and only
 * then hitting a post-hoc size check.
 *
 * Throws a {@link DeckLoadError} with code `E_TOO_LARGE` when the budget is
 * exceeded. The throw propagates out of `unzipSync`; callers that wrap this in
 * a try/catch must re-throw `DeckLoadError` instead of mapping it to a generic
 * "not a zip" error.
 */
export function safeUnzipSync(
  bytes: Uint8Array,
  budget: UnzipBudget,
): Record<string, Uint8Array> {
  let declaredTotal = 0;
  return unzipSync(bytes, {
    filter: (file: UnzipFileInfo): boolean => {
      // Directory members carry no payload; skip without counting them.
      if (file.name.endsWith('/')) {
        return false;
      }
      if (file.originalSize > budget.maxEntryBytes) {
        throw new DeckLoadError(
          'E_TOO_LARGE',
          `Archive entry exceeds the size limit before decompression: ${file.name}`,
        );
      }
      declaredTotal += file.originalSize;
      if (declaredTotal > budget.maxTotalBytes) {
        throw new DeckLoadError(
          'E_TOO_LARGE',
          'Archive exceeds the decompressed size budget before decompression.',
        );
      }
      return true;
    },
  });
}
