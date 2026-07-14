/**
 * Contract tests for the in-place slide text patch engine.
 *
 * Patches are applied to STATIC slide HTML with selectors that were
 * computed in the *running* DOM, so the suite pins:
 *   - the happy path (selector resolves, `before` anchor matches),
 *   - anchor safety (mismatched text is skipped, never overwritten),
 *   - idempotence (re-applying a patch counts as applied, no mutation),
 *   - the strict structural-selector grammar shared with the agent,
 *   - doctype preservation through the DOMParser round-trip.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SLIDE_PATCH_TEXT_LENGTH,
  SLIDE_PATCH_SELECTOR_RE,
  applySlidePatchesToHtml,
  isValidSlideTextPatch,
} from '@slidestage/core/deck/slidePatches';

const slideHtml = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Fixture</title></head>
  <body>
    <main>
      <div>
        <h1>Original title</h1>
        <p>First paragraph</p>
        <p>Second paragraph</p>
      </div>
    </main>
  </body>
</html>`;

describe('applySlidePatchesToHtml', () => {
  it('replaces the text of the selected element when the anchor matches', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
        before: 'Original title',
        after: 'Edited title',
      },
    ]);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.html).toContain('Edited title');
    expect(result.html).not.toContain('Original title');
    // Sibling content is untouched.
    expect(result.html).toContain('First paragraph');
    expect(result.html).toContain('Second paragraph');
  });

  it('disambiguates same-tag siblings via nth-of-type', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>p:nth-of-type(2)',
        before: 'Second paragraph',
        after: 'Second paragraph (edited)',
      },
    ]);
    expect(result.applied).toBe(1);
    expect(result.html).toContain('First paragraph');
    expect(result.html).toContain('Second paragraph (edited)');
  });

  it('tolerates whitespace-only differences in the before anchor', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
        before: '  Original   title ',
        after: 'Edited',
      },
    ]);
    expect(result.applied).toBe(1);
    expect(result.html).toContain('Edited');
  });

  it('skips (fails) a patch whose before anchor no longer matches', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
        before: 'Some other text entirely',
        after: 'Should not land',
      },
    ]);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    // Original string returned untouched when nothing applied.
    expect(result.html).toBe(slideHtml);
  });

  it('skips (fails) a patch whose selector resolves nothing', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>section:nth-of-type(9)',
        before: 'x',
        after: 'y',
      },
    ]);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.html).toBe(slideHtml);
  });

  it('is idempotent: an element already carrying `after` counts as applied', () => {
    const patch = {
      selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
      before: 'Original title',
      after: 'Edited title',
    };
    const first = applySlidePatchesToHtml(slideHtml, [patch]);
    const second = applySlidePatchesToHtml(first.html, [patch]);
    expect(second.applied).toBe(1);
    expect(second.failed).toBe(0);
    // No mutation happened, so the input string is returned as-is.
    expect(second.html).toBe(first.html);
  });

  it('applies multiple patches and counts mixed results', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
        before: 'Original title',
        after: 'Edited title',
      },
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>p:nth-of-type(1)',
        before: 'stale anchor',
        after: 'nope',
      },
    ]);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.html).toContain('Edited title');
    expect(result.html).toContain('First paragraph');
  });

  it('rejects structurally invalid patches without touching the DOM', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      { selector: 'h1[onclick="x"]', before: 'Original title', after: 'evil' },
    ]);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.html).toBe(slideHtml);
  });

  it('preserves the doctype through the round-trip', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
        before: 'Original title',
        after: 'Edited title',
      },
    ]);
    expect(result.html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
  });

  it('assigns textContent only — markup in `after` stays inert text', () => {
    const result = applySlidePatchesToHtml(slideHtml, [
      {
        selector: 'body>main:nth-of-type(1)>div:nth-of-type(1)>h1:nth-of-type(1)',
        before: 'Original title',
        after: '<img src=x onerror=alert(1)>',
      },
    ]);
    expect(result.applied).toBe(1);
    // Serializer must escape the payload — no live <img> tag in the HTML.
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;img');
  });

  it('returns the input untouched for an empty patch list', () => {
    const result = applySlidePatchesToHtml(slideHtml, []);
    expect(result).toEqual({ html: slideHtml, applied: 0, failed: 0 });
  });
});

describe('isValidSlideTextPatch / selector grammar', () => {
  const good = {
    selector: 'body>main:nth-of-type(1)>h1:nth-of-type(2)',
    before: 'a',
    after: 'b',
  };

  it('accepts the agent-generated structural shape', () => {
    expect(isValidSlideTextPatch(good)).toBe(true);
    expect(SLIDE_PATCH_SELECTOR_RE.test('body')).toBe(true);
    expect(
      SLIDE_PATCH_SELECTOR_RE.test('body>custom-el:nth-of-type(12)>p:nth-of-type(3)'),
    ).toBe(true);
  });

  it('rejects anything outside the structural grammar', () => {
    const badSelectors = [
      '',
      'div>h1:nth-of-type(1)', // must start at body
      'body>h1', // missing nth-of-type
      'body>h1:nth-child(1)', // wrong pseudo
      'body>h1:nth-of-type(1),body', // comma
      'body>h1:nth-of-type(1) p:nth-of-type(1)', // descendant combinator
      'body>h1:nth-of-type(1)[onclick]', // attribute selector
      'body>#id:nth-of-type(1)', // id
      'body>h1:nth-of-type(99999)', // >4 digits
    ];
    for (const selector of badSelectors) {
      expect(isValidSlideTextPatch({ ...good, selector }), selector).toBe(false);
    }
  });

  it('rejects non-string fields and oversized text', () => {
    expect(isValidSlideTextPatch(null)).toBe(false);
    expect(isValidSlideTextPatch({ ...good, before: 1 })).toBe(false);
    expect(isValidSlideTextPatch({ ...good, after: undefined })).toBe(false);
    expect(
      isValidSlideTextPatch({ ...good, after: 'x'.repeat(MAX_SLIDE_PATCH_TEXT_LENGTH + 1) }),
    ).toBe(false);
    expect(
      isValidSlideTextPatch({ ...good, before: 'x'.repeat(MAX_SLIDE_PATCH_TEXT_LENGTH) }),
    ).toBe(true);
  });
});
