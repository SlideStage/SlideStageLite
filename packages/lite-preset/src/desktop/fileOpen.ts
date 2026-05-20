/**
 * Bridges Tauri's file-open machinery to the same `(file: File) => void`
 * callback the renderer already uses for drag-and-drop and the file
 * picker.
 *
 * Wiring is two-way:
 *   1. On mount we drain `invoke('opened_urls')` (preferred) plus the
 *      legacy `invoke('pending_file')` so older Rust builds keep working.
 *      Both surface paths that arrived BEFORE the front-end was ready —
 *      e.g. the user double-clicked `.stage` to cold-launch the app.
 *   2. We subscribe to both `opened` (new, payload = `string[]`) and the
 *      pre-existing `deck:open` (payload = `string`) so the warm path
 *      survives the rename and any plugin (deep-link / single-instance)
 *      that re-emits the legacy name.
 *
 * All `@tauri-apps/api/*` imports are dynamic so the Web bundle never
 * pulls them in.
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
    // Tauri serializes `Vec<u8>` as a JSON array (number[]); we normalize
    // it into a fresh, non-shared ArrayBuffer so `File`'s BlobPart type
    // accepts it under TypeScript 6's stricter ArrayBufferLike rules.
    const source: ArrayLike<number> = Array.isArray(bytes)
      ? bytes
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
    const buffer = new ArrayBuffer(source.length);
    new Uint8Array(buffer).set(source as ArrayLike<number>);
    const name = path.split(/[\\/]/).pop() ?? 'deck.stage';
    return new File([buffer], name, { type: 'application/x-stage' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('read_deck_bytes failed', err);
    return null;
  }
}

function normalizePathLike(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  // macOS / iOS deliver `file:///absolute/path` URLs via RunEvent::Opened
  // -> Url::to_file_path lossy stringification. Strip the scheme so the
  // Rust `read_deck_bytes` (which takes an absolute fs path) is happy.
  if (input.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(input).pathname);
    } catch {
      return input;
    }
  }
  return input;
}

async function feedPath(
  path: string,
  onFile: (file: File) => void | Promise<void>,
): Promise<void> {
  const normalized = normalizePathLike(path);
  if (!normalized) return;
  const file = await readFileFromPath(normalized);
  if (file) await onFile(file);
}

async function drainPending(
  onFile: (file: File) => void | Promise<void>,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const urls = await invoke<string[] | null>('opened_urls').catch(() => null);
    if (Array.isArray(urls)) {
      for (const u of urls) {
        await feedPath(u, onFile);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('opened_urls drain failed', err);
  }
  try {
    const pending = await invoke<string | null>('pending_file').catch(() => null);
    if (pending) await feedPath(pending, onFile);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('pending_file drain failed', err);
  }
}

export async function attachDesktopFileOpen(
  onFile: (file: File) => void | Promise<void>,
): Promise<DesktopFileOpenHandle> {
  const { listen } = await import('@tauri-apps/api/event');

  // Attach warm-path listeners FIRST so we never lose an event fired by
  // the Rust side between the pending drain and the subscribe.
  const unlistenOpened = await listen<string[] | string>('opened', async (event) => {
    const payload = event.payload;
    if (Array.isArray(payload)) {
      for (const p of payload) await feedPath(p, onFile);
    } else if (typeof payload === 'string') {
      await feedPath(payload, onFile);
    }
  });

  const unlistenDeckOpen = await listen<string>('deck:open', async (event) => {
    if (event.payload) await feedPath(event.payload, onFile);
  });

  await drainPending(onFile);

  return {
    unsubscribe(): void {
      try {
        unlistenOpened();
      } catch {
        // ignore
      }
      try {
        unlistenDeckOpen();
      } catch {
        // ignore
      }
    },
  };
}
