/**
 * Runtime detection: are we in a Tauri WebView host or a plain browser?
 *
 * Tauri 2 exposes a stable `__TAURI_INTERNALS__` global on the window
 * before any user JS runs, so we can branch on it synchronously at the
 * top of any module that needs to pick between Web vs Desktop transport.
 *
 * We deliberately keep this check tiny + dependency-free so it can be
 * called from constructors / module init without dragging the Tauri JS
 * client into the Web bundle.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window;
}
