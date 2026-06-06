/**
 * Persist a freshly-built PDF to disk.
 *
 * Two hosts, two flows:
 *   - Web: hand the user a normal browser download via a transient
 *     `<a download>` + object URL.
 *   - Tauri desktop: open a native "Save as" dialog and write the bytes
 *     with the fs plugin. Both Tauri imports are dynamic so the Web
 *     bundle never pulls them in (mirrors `desktop/fileOpen.ts`).
 */
import { isTauri } from '../desktop/env';

/**
 * Turn a deck title / file name into a safe, single-segment `*.pdf` file
 * name. Strips path separators, control chars, and reserved characters;
 * collapses whitespace; caps the length.
 */
export function sanitizePdfFilename(name: string): string {
  const base = (name ?? '').trim().replace(/\.pdf$/i, '');
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = cleaned.length > 0 ? cleaned.slice(0, 120).trim() : 'slides';
  return `${safe || 'slides'}.pdf`;
}

function saveViaBrowser(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh ArrayBuffer so Blob accepts it under TS 6's
  // stricter ArrayBufferLike typing even when `bytes` is a subarray.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'application/pdf' });
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
    // Revoke on the next tick so the download has a chance to start.
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
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  // User cancelled the dialog.
  if (!path) return;
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(path, bytes);
}

/**
 * Save `bytes` as `filename` using the host-appropriate flow. Resolves
 * once the download has been triggered (Web) or the file written / dialog
 * cancelled (Tauri).
 */
export async function savePdf(bytes: Uint8Array, filename: string): Promise<void> {
  const safeName = sanitizePdfFilename(filename);
  if (isTauri()) {
    await saveViaTauri(bytes, safeName);
    return;
  }
  saveViaBrowser(bytes, safeName);
}
