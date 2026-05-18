import { DeckLoadError } from './types';

const externalSchemePattern = /^[a-z][a-z0-9+.-]*:/i;

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

export function isExternalReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('mailto:') ||
    externalSchemePattern.test(trimmed)
  );
}

export function splitReferenceSuffix(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return {
    path: match?.[1] ?? value,
    suffix: match?.[2] ?? '',
  };
}

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
