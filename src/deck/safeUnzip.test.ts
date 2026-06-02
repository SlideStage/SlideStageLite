// @vitest-environment node
//
// Node environment required for the same reason as loadDeck.test.ts: jsdom +
// vitest expose a cross-realm `Uint8Array` that breaks fflate's `zipSync`
// (every byte is treated as a sub-directory entry).

import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { safeUnzipSync } from '@slidestage/core/deck/safeUnzip';
import { DeckLoadError } from '@slidestage/core/deck/types';

function makeZip(files: Record<string, string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) {
    input[name] = strToU8(body);
  }
  return zipSync(input);
}

describe('safeUnzipSync', () => {
  it('unzips entries that fit inside the budget', () => {
    const zip = makeZip({ 'manifest.json': '{"ok":true}', 'a.txt': 'hello' });
    const out = safeUnzipSync(zip, { maxEntryBytes: 1024, maxTotalBytes: 1024 });
    expect(Object.keys(out).sort()).toEqual(['a.txt', 'manifest.json']);
    expect(new TextDecoder().decode(out['a.txt'])).toBe('hello');
  });

  it('rejects an entry whose declared size exceeds maxEntryBytes', () => {
    const zip = makeZip({ 'big.bin': 'x'.repeat(200) });
    try {
      safeUnzipSync(zip, { maxEntryBytes: 10, maxTotalBytes: 1_000_000 });
      throw new Error('expected safeUnzipSync to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DeckLoadError);
      expect((error as DeckLoadError).code).toBe('E_TOO_LARGE');
      expect((error as Error).message).toMatch(/before decompression/);
    }
  });

  it('rejects once the running total exceeds maxTotalBytes', () => {
    const zip = makeZip({ 'a.txt': 'x'.repeat(40), 'b.txt': 'y'.repeat(40) });
    try {
      safeUnzipSync(zip, { maxEntryBytes: 100, maxTotalBytes: 50 });
      throw new Error('expected safeUnzipSync to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DeckLoadError);
      expect((error as DeckLoadError).code).toBe('E_TOO_LARGE');
      expect((error as Error).message).toMatch(/decompressed size budget/);
    }
  });

  it('still surfaces a parse failure for non-zip input', () => {
    const notZip = strToU8('definitely not a zip archive');
    expect(() => safeUnzipSync(notZip, { maxEntryBytes: 1024, maxTotalBytes: 1024 })).toThrow();
  });
});
