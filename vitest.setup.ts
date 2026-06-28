// Vitest global setup: guarantee a working Web Storage in the test env.
//
// On Node 22+ (this repo currently runs Node 26) `globalThis.localStorage`
// is a native, experimental implementation that is *disabled* unless the
// process is started with `--localstorage-file`. Because vitest's jsdom
// environment shares the global object (`window === globalThis`), that
// inert native getter shadows jsdom's own Storage and `window.localStorage`
// reads back as `undefined` — breaking every test that does
// `window.localStorage.clear()` in `beforeEach`.
//
// We install a tiny spec-compatible in-memory Storage, but ONLY when the
// ambient storage is non-functional, so environments where jsdom already
// provides a real Storage (e.g. older Node in CI) are left untouched.
//
// The implementation is a real class with its methods on the prototype, so
// tests that do `vi.spyOn(Storage.prototype, 'setItem')` keep working and
// the spy is observed by the live `localStorage` instance.

class MemoryStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    const k = String(key);
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  key(index: number): string | null {
    if (!Number.isInteger(index) || index < 0) return null;
    const keys = Array.from(this.map.keys());
    return index < keys.length ? keys[index] : null;
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
}

function isWorkingStorage(candidate: unknown): boolean {
  try {
    if (!candidate) return false;
    const storage = candidate as Storage;
    const probe = '__slidestage_storage_probe__';
    storage.setItem(probe, '1');
    const ok = storage.getItem(probe) === '1';
    storage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

function define(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } catch {
    try {
      (globalThis as Record<string, unknown>)[name] = value;
    } catch {
      // Nothing else we can do; tests will surface the failure.
    }
  }
}

const ambient = (globalThis as { localStorage?: unknown }).localStorage;
if (!isWorkingStorage(ambient)) {
  // Expose the constructor so `Storage.prototype` spies resolve to the
  // same prototype the live instances use.
  define('Storage', MemoryStorage);
  define('localStorage', new MemoryStorage());
  define('sessionStorage', new MemoryStorage());
}
