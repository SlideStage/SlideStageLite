import { DeckLoadError } from './types';

const externalSchemePattern = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalize a package-relative path into a safe, canonical form.
 *
 * Returns the normalized path on success, or throws
 * {@link DeckLoadError} with code `E_PATH_TRAVERSAL` for any unsafe
 * input. The validator rejects empty strings, absolute paths, `..`
 * segments, embedded NUL bytes, and the legacy Windows path separator
 * (`\\` is rewritten to `/` first, then segment-checked).
 */
export function normalizePackagePath(path: string): string {
  if (!path || path.includes('\0')) {
    throw new DeckLoadError('E_PATH_TRAVERSAL', `Invalid empty package path.`);
  }

  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    throw new DeckLoadError('E_PATH_TRAVERSAL', `Absolute paths are not allowed: ${path}`);
  }

  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      throw new DeckLoadError('E_PATH_TRAVERSAL', `Path traversal is not allowed: ${path}`);
    }
    parts.push(part);
  }

  if (parts.length === 0) {
    throw new DeckLoadError('E_PATH_TRAVERSAL', `Invalid empty package path.`);
  }

  return parts.join('/');
}

/**
 * Throws-only convenience wrapper around {@link normalizePackagePath}.
 * Useful in upload pipelines and validators that only need to gate on
 * path safety and have no use for the normalized result.
 */
export function assertSafePath(path: string): void {
  normalizePackagePath(path);
}

/**
 * Return `true` when the reference is an external URL, a fragment, an
 * absolute path, a data/blob/mailto URI, or any other non-package-local
 * value the rewriter must leave untouched.
 */
export function isExternalReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('#') ||
    // Any absolute path: `//foo` (scheme-relative URLs) and `/foo`
    // (host-rooted paths). Both forms cannot be package-relative —
    // the loader rejects `/`-leading entries in `normalizePackagePath`
    // — so we treat them as external and leave them alone.
    //
    // This matters specifically for the rewriter's @import-inline
    // pass: after `@import url("../assets/_mirror/css/foo.css")` is
    // spliced inline, the inner CSS body's `url("../font/x.ttf")`
    // is recursively rewritten to the package-virtual URL
    // `/__stage/<id>/assets/_mirror/font/x.ttf`. The outer pass
    // then walks the spliced text again — without this guard
    // it would mistakenly treat that absolute URL as a relative
    // path and double-prefix it to
    // `/__stage/<id>/shared/__stage/<id>/assets/_mirror/font/x.ttf`,
    // causing every CJK font to 404.
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('mailto:') ||
    externalSchemePattern.test(trimmed)
  );
}

/**
 * Split a reference into its path portion and its trailing `?query` /
 * `#fragment` suffix. The suffix is preserved verbatim by the rewriter
 * after the path is resolved.
 */
export function splitReferenceSuffix(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return {
    path: match?.[1] ?? value,
    suffix: match?.[2] ?? '',
  };
}

/**
 * Resolve a package-relative reference appearing in the file at
 * `fromPath` to a normalized package path. Returns `null` for external,
 * empty, or fragment-only references that the rewriter should leave
 * untouched. Throws `E_PATH_TRAVERSAL` when the reference would escape
 * the package root.
 */
export function resolvePackageReference(fromPath: string, reference: string): string | null {
  if (!reference || isExternalReference(reference)) {
    return null;
  }

  const { path } = splitReferenceSuffix(reference);
  if (!path) {
    return null;
  }

  const baseParts = normalizePackagePath(fromPath).split('/');
  baseParts.pop();

  const output = [...baseParts];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (output.length === 0) {
        throw new DeckLoadError('E_PATH_TRAVERSAL', `Reference escapes package root: ${reference}`);
      }
      output.pop();
      continue;
    }
    output.push(part);
  }

  if (output.length === 0) {
    return null;
  }

  return normalizePackagePath(output.join('/'));
}
