/**
 * Persist a `.stage` copy to disk. Mirrors `downloadPdf.ts`:
 *   - Web: transient `<a download>` + object URL.
 *   - Tauri: native "Save as" dialog + fs plugin (dynamic imports so the
 *     Web bundle never pulls them in).
 */
import { isTauri } from '../desktop/env';

/**
 * Derive the `.edited.stage` copy name from the source file name:
 * `talk.stage` → `talk.edited.stage`. Strips path separators, control and
 * reserved characters; collapses whitespace; caps the length. Re-exporting
 * an already-edited copy does not stack suffixes.
 */
export function editedStageFilename(sourceName: string): string {
  const base = (sourceName ?? '')
    .trim()
    .replace(/\.stage$/i, '')
    .replace(/\.edited$/i, '');
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = cleaned.length > 0 ? cleaned.slice(0, 120).trim() : 'deck';
  return `${safe || 'deck'}.edited.stage`;
}

function saveViaBrowser(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh ArrayBuffer so Blob accepts it under TS 6's
  // stricter ArrayBufferLike typing even when `bytes` is a subarray.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 1_000);
  }
}

async function saveViaTauri(bytes: Uint8Array, filename: string): Promise<void> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'SlideStage deck', extensions: ['stage'] }],
  });
  // User cancelled the dialog.
  if (!path) return;
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(path, bytes);
}

/**
 * Save `bytes` under `filename` using the host-appropriate flow. Resolves
 * once the download has been triggered (Web) or the file written / dialog
 * cancelled (Tauri).
 */
export async function saveStageFile(bytes: Uint8Array, filename: string): Promise<void> {
  if (isTauri()) {
    await saveViaTauri(bytes, filename);
    return;
  }
  saveViaBrowser(bytes, filename);
}
