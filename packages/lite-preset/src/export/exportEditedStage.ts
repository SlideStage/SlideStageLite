// Build an edited `.stage` copy: original archive bytes + stored text
// patches baked into the slide HTML.
//
// The original package is unzipped, ONLY the patched slide entries are
// re-encoded, and everything is re-zipped verbatim (manifest.json bytes
// included) via `packStageEntries`. The copy therefore differs from the
// source exactly where the user edited — but it IS a new file with a new
// fingerprint, so opening it re-runs the trust prompt and starts fresh
// per-deck persistence. The source file is never modified.

import { packStageEntries } from '@slidestage/core/converter/pack';
import { normalizePackagePath } from '@slidestage/core/deck/pathSafety';
import { safeUnzipSync } from '@slidestage/core/deck/safeUnzip';
import { applySlidePatchesToHtml } from '@slidestage/core/deck/slidePatches';
import type { Manifest } from '@slidestage/core/deck/types';
import type { StoredDeckEdits } from '../persistence/editsStore';

// Mirror the loader's unzip budgets (loadDeck.ts) — the source deck
// already passed them when it was opened.
const maxEntryBytes = 100 * 1024 * 1024;
const maxTotalBytes = 1024 * 1024 * 1024;

export interface EditedStageResult {
  bytes: Uint8Array;
  /** Patches that landed in the copy. */
  applied: number;
  /** Patches skipped because their target/anchor no longer matched. */
  failed: number;
}

/**
 * Apply `edits` to the `.stage` archive in `source` and return the
 * repacked copy. Throws when the source is not a readable zip; individual
 * patch mismatches are counted in `failed` instead of throwing.
 */
export function buildEditedStageBytes(
  source: Uint8Array,
  manifest: Manifest,
  edits: StoredDeckEdits,
): EditedStageResult {
  const raw = safeUnzipSync(source, { maxEntryBytes, maxTotalBytes });

  const entries = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(raw)) {
    if (path.endsWith('/')) continue;
    entries.set(normalizePackagePath(path), bytes);
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let applied = 0;
  let failed = 0;

  for (const [key, patches] of Object.entries(edits)) {
    if (patches.length === 0) continue;
    const slide = manifest.slides[Number(key)];
    const path = slide ? normalizePackagePath(slide.file) : null;
    const bytes = path ? entries.get(path) : undefined;
    if (!path || !bytes) {
      failed += patches.length;
      continue;
    }
    const html = decoder.decode(bytes);
    const result = applySlidePatchesToHtml(html, patches);
    applied += result.applied;
    failed += result.failed;
    if (result.html !== html) {
      entries.set(path, encoder.encode(result.html));
    }
  }

  const mtimeMs = Date.parse(manifest.createdAt);
  const bytes = packStageEntries(entries, {
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
  });
  return { bytes, applied, failed };
}
