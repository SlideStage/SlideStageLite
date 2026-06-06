import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { buildSlidesPdf } from '@slidestage/lite-preset/export/buildSlidesPdf';

/**
 * A 1×1 transparent PNG. Decoded from base64 so the test stays
 * dependency-free (no fs / fixtures) and pdf-lib has a real raster to
 * embed.
 */
function tinyPng(): Uint8Array {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

describe('buildSlidesPdf', () => {
  it('produces a valid PDF with one page per slide image', async () => {
    const png = tinyPng();
    const bytes = await buildSlidesPdf([{ png }, { png }, { png }], {
      pageWidth: 1280,
      pageHeight: 720,
      title: 'My Deck',
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    // PDF magic header.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');

    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(3);
    expect(reloaded.getTitle()).toBe('My Deck');

    const [first] = reloaded.getPages();
    expect(Math.round(first.getWidth())).toBe(1280);
    expect(Math.round(first.getHeight())).toBe(720);
  });

  it('keeps the deck native aspect ratio (no forced A4)', async () => {
    const bytes = await buildSlidesPdf([{ png: tinyPng() }], {
      pageWidth: 1000,
      pageHeight: 1000,
    });
    const reloaded = await PDFDocument.load(bytes);
    const [page] = reloaded.getPages();
    expect(Math.round(page.getWidth())).toBe(1000);
    expect(Math.round(page.getHeight())).toBe(1000);
  });

  it('throws when there are no pages', async () => {
    await expect(
      buildSlidesPdf([], { pageWidth: 100, pageHeight: 100 }),
    ).rejects.toThrow(/no pages/i);
  });

  it('throws on invalid page dimensions', async () => {
    await expect(
      buildSlidesPdf([{ png: tinyPng() }], { pageWidth: 0, pageHeight: 100 }),
    ).rejects.toThrow(/invalid page dimensions/i);
  });
});
