/**
 * Path-segment skip rules applied uniformly by the CLI's folder walker and
 * the SPA's folder drop. The rule of thumb: drop paths that almost
 * certainly belong to a developer's workspace (`.git`, `node_modules`,
 * editor metadata) but keep anything else, even when its content is not
 * HTML — the converter is happy to copy fonts, images, JSON, etc. into the
 * resulting package.
 *
 * Patterns match against either:
 * - A path **segment** (anything between `/` separators), exact match.
 * - A leaf **file name** (the last segment), exact match or `*.ext` glob.
 *
 * `shouldSkipFolderPath('a/b/c')` returns `true` as soon as any segment
 * matches, so dropping a folder also drops its subtree.
 */

export interface SkipPattern {
  /** Anchor: 'segment' matches any path component; 'leaf' only the last. */
  anchor: 'segment' | 'leaf';
  /** Exact segment/leaf name, or `*.ext` glob (leaf-only). */
  match: string;
}

export const DEFAULT_FOLDER_SKIP_PATTERNS: ReadonlyArray<SkipPattern> = [
  { anchor: 'segment', match: '.git' },
  { anchor: 'segment', match: 'node_modules' },
  { anchor: 'segment', match: '.idea' },
  { anchor: 'segment', match: '.vscode' },
  { anchor: 'segment', match: '.DS_Store' },
  { anchor: 'leaf', match: '.DS_Store' },
  { anchor: 'leaf', match: 'Thumbs.db' },
  { anchor: 'leaf', match: '*~' },
  { anchor: 'leaf', match: '*.swp' },
];

function matchesGlob(leaf: string, pattern: string): boolean {
  if (pattern === leaf) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return leaf.endsWith(suffix);
  }
  if (pattern.endsWith('~')) {
    return leaf.endsWith('~');
  }
  return false;
}

export function shouldSkipFolderPath(
  path: string,
  patterns: ReadonlyArray<SkipPattern> = DEFAULT_FOLDER_SKIP_PATTERNS,
): boolean {
  if (path.length === 0) return true;

  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return true;

  const leaf = segments[segments.length - 1];

  for (const pattern of patterns) {
    if (pattern.anchor === 'leaf') {
      if (matchesGlob(leaf, pattern.match)) return true;
      continue;
    }
    // segment
    for (const segment of segments) {
      if (segment === pattern.match) return true;
    }
  }

  return false;
}
