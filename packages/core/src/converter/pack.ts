import { zipSync, type AsyncZippable } from 'fflate';
import { normalizePackagePath } from '../deck/pathSafety';
import type { Manifest } from '../deck/types';

const encoder = new TextEncoder();

export function asPlainUint8(view: Uint8Array): Uint8Array {
  // Coerce to a realm-local Uint8Array because fflate's zipSync uses
  // `value instanceof Uint8Array` to decide whether to treat a value as
  // file bytes vs. a nested folder; vitest + jsdom can return Uint8Array
  // instances whose prototype differs from this realm's Uint8Array.
  if (Object.getPrototypeOf(view) === Uint8Array.prototype) {
    return view;
  }
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function manifestMtime(manifest: Manifest): number {
  const parsed = Date.parse(manifest.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Pack a manifest plus a bag of slide / asset entries into a `.stage` ZIP.
 *
 * Entries are written in the order they appear in `entries`. The manifest is
 * always emitted at the root and overwrites any colliding key in `entries`.
 *
 * Every entry's per-file mtime is pinned to the manifest's `createdAt` so
 * the zip is bit-for-bit reproducible: byte-identical inputs produce
 * byte-identical outputs, which lets the loader compute a content-only
 * sha256 fingerprint that survives re-conversion. (fflate defaults the
 * mtime to "now", which would otherwise make every conversion produce a
 * different zip and invalidate stored trust grants / annotations.)
 */
export function packStage(
  manifest: Manifest,
  entries: Map<string, Uint8Array>,
): Uint8Array {
  const mtime = manifestMtime(manifest);
  const files: AsyncZippable = {};

  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    // Defense-in-depth against Zip Slip (CWE-22): this is the sink — `zipSync`
    // writes these keys verbatim into the archive that downstream tools
    // extract to disk. Reject any entry that escapes the package root even if
    // a caller forgot to normalize. `normalizePackagePath` is idempotent for
    // already-safe keys, so reproducible output is preserved.
    const safePath = normalizePackagePath(path);
    files[safePath] = [asPlainUint8(bytes), { mtime }];
  }

  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  files['manifest.json'] = [asPlainUint8(encoder.encode(manifestJson)), { mtime }];

  return zipSync(files, { level: 9, mtime });
}

export function bytesFromString(value: string): Uint8Array {
  return encoder.encode(value);
}
