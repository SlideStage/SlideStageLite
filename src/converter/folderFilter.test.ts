import { describe, expect, it } from 'vitest';
import { shouldSkipFolderPath } from '@slidestage/core/converter/folderFilter';

describe('shouldSkipFolderPath', () => {
  it('keeps unremarkable paths', () => {
    expect(shouldSkipFolderPath('index.html')).toBe(false);
    expect(shouldSkipFolderPath('assets/theme.css')).toBe(false);
    expect(shouldSkipFolderPath('slides/01-cover.html')).toBe(false);
    expect(shouldSkipFolderPath('fonts/Inter-Regular.woff2')).toBe(false);
  });

  it('skips developer-workspace folders at any depth', () => {
    expect(shouldSkipFolderPath('.git/HEAD')).toBe(true);
    expect(shouldSkipFolderPath('subdir/.git/index')).toBe(true);
    expect(shouldSkipFolderPath('node_modules/foo/index.js')).toBe(true);
    expect(shouldSkipFolderPath('vendor/node_modules/foo.js')).toBe(true);
    expect(shouldSkipFolderPath('.idea/workspace.xml')).toBe(true);
    expect(shouldSkipFolderPath('.vscode/settings.json')).toBe(true);
  });

  it('skips known OS / editor noise leaves', () => {
    expect(shouldSkipFolderPath('slides/.DS_Store')).toBe(true);
    expect(shouldSkipFolderPath('Thumbs.db')).toBe(true);
    expect(shouldSkipFolderPath('foo/bar/Thumbs.db')).toBe(true);
    expect(shouldSkipFolderPath('foo/bar/README~')).toBe(true);
    expect(shouldSkipFolderPath('a/b/c.swp')).toBe(true);
  });

  it('treats backslash separators on Windows-style inputs as path separators', () => {
    expect(shouldSkipFolderPath('node_modules\\foo\\index.js')).toBe(true);
    expect(shouldSkipFolderPath('assets\\theme.css')).toBe(false);
  });

  it('rejects empty and root-only paths', () => {
    expect(shouldSkipFolderPath('')).toBe(true);
    expect(shouldSkipFolderPath('/')).toBe(true);
  });
});
