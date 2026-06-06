import { describe, expect, it } from 'vitest';

import { sanitizePdfFilename } from '@slidestage/lite-preset/export/downloadPdf';

describe('sanitizePdfFilename', () => {
  it('appends a .pdf extension', () => {
    expect(sanitizePdfFilename('Quarterly review')).toBe('Quarterly review.pdf');
  });

  it('does not double up an existing .pdf extension', () => {
    expect(sanitizePdfFilename('deck.pdf')).toBe('deck.pdf');
    expect(sanitizePdfFilename('deck.PDF')).toBe('deck.pdf');
  });

  it('strips path separators and reserved characters', () => {
    expect(sanitizePdfFilename('a/b\\c:d*e?f"g<h>i|j')).toBe(
      'a_b_c_d_e_f_g_h_i_j.pdf',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizePdfFilename('  spaced   out  ')).toBe('spaced out.pdf');
  });

  it('falls back to a default when the name is empty', () => {
    expect(sanitizePdfFilename('')).toBe('slides.pdf');
    expect(sanitizePdfFilename('   ')).toBe('slides.pdf');
  });

  it('keeps CJK and unicode letters intact', () => {
    expect(sanitizePdfFilename('季度汇报')).toBe('季度汇报.pdf');
  });

  it('caps very long names', () => {
    const out = sanitizePdfFilename('x'.repeat(500));
    // 120 char cap + ".pdf"
    expect(out.length).toBeLessThanOrEqual(124);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});
