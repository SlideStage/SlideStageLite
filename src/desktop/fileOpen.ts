/**
 * Bridges the Tauri main process file-open machinery to the same
 * `(file: File) => void` callback the renderer already uses for
 * drag-and-drop and the file picker.
 *
 * Wiring is two-way:
 *   1. On mount, `invoke('pending_file')` drains any path captured
 *      *before* the front-end was ready (e.g. user double-clicked the
 *      `.hcslides` to launch the app cold).
 *   2. We subscribe to `deck:open` events emitted by the Rust side when
 *      a new path arrives via single-instance / deep-link / file
 *      association.
 *
 * Dynamically imports `@tauri-apps/api/*` so the Web build never bundles
 * them.
 */
export interface DesktopFileOpenHandle {
  unsubscribe(): void;
}

async function readFileFromPath(path: string): Promise<File | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const bytes = await invoke<number[] | Uint8Array | ArrayBuffer>('read_deck_bytes', {
      path,
    });
    // Tauri serializes Vec<u8> as a JSON array (number[]); we normalize
    // it into a fresh, non-shared ArrayBuffer so File's BlobPart type
    // accepts it under TypeScript 6's stricter ArrayBufferLike rules.
    const source: ArrayLike<number> = Array.isArray(bytes)
      ? bytes
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
    const buffer = new ArrayBuffer(source.length);
    new Uint8Array(buffer).set(source as ArrayLike<number>);
    const name = path.split(/[\\/]/).pop() ?? 'deck.hcslides';
    return new File([buffer], name, { type: 'application/x-hcslides' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('read_deck_bytes failed', err);
    return null;
  }
}

export async function attachDesktopFileOpen(
  onFile: (file: File) => void | Promise<void>,
): Promise<DesktopFileOpenHandle> {
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);

  try {
    const pending = await invoke<string | null>('pending_file');
    if (pending) {
      const file = await readFileFromPath(pending);
      if (file) await onFile(file);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('pending_file probe failed', err);
  }

  const unlisten = await listen<string>('deck:open', async (event) => {
    const path = event.payload;
    if (!path) return;
    const file = await readFileFromPath(path);
    if (file) await onFile(file);
  });

  return {
    unsubscribe(): void {
      try {
        unlisten();
      } catch {
        // ignore
      }
    },
  };
}
