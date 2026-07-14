/**
 * Contract tests for the edited-copy `.stage` export.
 *
 * Pins that:
 *   - stored patches land in the copy's slide HTML,
 *   - every OTHER entry (manifest.json included) survives byte-for-byte —
 *     the repack must not re-serialize producer metadata,
 *   - mismatched patches are counted, never corrupting the slide,
 *   - the output re-zips reproducibly (same input+edits → same bytes),
 *   - the `.edited.stage` filename derivation is stable and safe.
 */
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { asPlainUint8 } from '@slidestage/core/converter/pack';
import type { Manifest } from '@slidestage/core/deck/types';
import { buildEditedStageBytes } from '@slidestage/lite-preset/export/exportEditedStage';
import { editedStageFilename } from '@slidestage/lite-preset/export/downloadStage';

const manifest: Manifest = {
  schema: 'slidestage@1.0',
  id: 'edit-export-fixture',
  version: '1.0.0',
  title: 'Edit Export Fixture',
  subtitle: null,
  author: null,
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  architecture: 'multi-file',
  dimensions: { width: 1920, height: 1080 },
  totalSlides: 2,
  slides: [
    { index: 1, id: 'one', label: 'One', file: 'slides/01.html', thumbnail: null, notes: null },
    { index: 2, id: 'two', label: 'Two', file: 'slides/02.html', thumbnail: null, notes: null },
  ],
};

// Manifest JSON with deliberate extras the zod schema would drop — the
// export must keep these bytes verbatim.
const manifestJson = `${JSON.stringify(
  { ...manifest, xProducerExtra: { keep: 'me' } },
  null,
  2,
)}\n`;

const slideOne = `<!doctype html><html><body><main><h1>Hello one</h1></main></body></html>`;
const slideTwo = `<!doctype html><html><body><main><h1>Hello two</h1></main></body></html>`;
const cssBytes = strToU8(':root { color: red; }');

function buildFixtureZip(): Uint8Array {
  return zipSync({
    'manifest.json': asPlainUint8(strToU8(manifestJson)),
    'shared/theme.css': asPlainUint8(cssBytes),
    'slides/01.html': asPlainUint8(strToU8(slideOne)),
    'slides/02.html': asPlainUint8(strToU8(slideTwo)),
  });
}

const editH1 = {
  selector: 'body>main:nth-of-type(1)>h1:nth-of-type(1)',
  before: 'Hello one',
  after: 'Edited one',
};

describe('buildEditedStageBytes', () => {
  it('bakes patches into the targeted slide only', () => {
    const result = buildEditedStageBytes(buildFixtureZip(), manifest, {
      0: [editH1],
    });
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);

    const out = unzipSync(result.bytes);
    const decoder = new TextDecoder();
    expect(decoder.decode(out['slides/01.html'])).toContain('Edited one');
    expect(decoder.decode(out['slides/01.html'])).not.toContain('Hello one');
    expect(decoder.decode(out['slides/02.html'])).toBe(slideTwo);
  });

  it('keeps every untouched entry byte-for-byte, manifest included', () => {
    const result = buildEditedStageBytes(buildFixtureZip(), manifest, {
      0: [editH1],
    });
    const out = unzipSync(result.bytes);
    expect(new TextDecoder().decode(out['manifest.json'])).toBe(manifestJson);
    expect(new TextDecoder().decode(out['manifest.json'])).toContain('xProducerExtra');
    expect(Array.from(out['shared/theme.css'])).toEqual(Array.from(cssBytes));
    expect(Object.keys(out).sort()).toEqual([
      'manifest.json',
      'shared/theme.css',
      'slides/01.html',
      'slides/02.html',
    ]);
  });

  it('counts mismatched patches as failed and leaves the slide intact', () => {
    const result = buildEditedStageBytes(buildFixtureZip(), manifest, {
      0: [{ ...editH1, before: 'stale anchor' }],
      7: [editH1], // slide index out of range
    });
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(2);
    const out = unzipSync(result.bytes);
    expect(new TextDecoder().decode(out['slides/01.html'])).toBe(slideOne);
  });

  it('is reproducible: identical input + edits → identical bytes', () => {
    const a = buildEditedStageBytes(buildFixtureZip(), manifest, { 0: [editH1] });
    const b = buildEditedStageBytes(buildFixtureZip(), manifest, { 0: [editH1] });
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it('bakes text-run (textNode) patches into mixed-content slides', () => {
    const mixedSlide =
      '<!doctype html><html><body><main><h1>投资组合<span>实证分析</span></h1></main></body></html>';
    const zip = zipSync({
      'manifest.json': asPlainUint8(strToU8(manifestJson)),
      'shared/theme.css': asPlainUint8(cssBytes),
      'slides/01.html': asPlainUint8(strToU8(mixedSlide)),
      'slides/02.html': asPlainUint8(strToU8(slideTwo)),
    });
    const result = buildEditedStageBytes(zip, manifest, {
      0: [
        {
          selector: 'body>main:nth-of-type(1)>h1:nth-of-type(1)',
          before: '投资组合',
          after: '资产配置',
          textNode: 0,
        },
      ],
    });
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    const out = unzipSync(result.bytes);
    const html = new TextDecoder().decode(out['slides/01.html']);
    expect(html).toContain('资产配置<span>实证分析</span>');
    expect(html).not.toContain('投资组合');
  });

  it('throws on a non-zip source', () => {
    expect(() =>
      buildEditedStageBytes(strToU8('not a zip'), manifest, { 0: [editH1] }),
    ).toThrow();
  });
});

describe('editedStageFilename', () => {
  it('derives name.edited.stage from name.stage', () => {
    expect(editedStageFilename('talk.stage')).toBe('talk.edited.stage');
  });

  it('does not stack .edited suffixes on re-export', () => {
    expect(editedStageFilename('talk.edited.stage')).toBe('talk.edited.stage');
  });

  it('sanitizes path separators and reserved characters', () => {
    expect(editedStageFilename('a/b\\c:d.stage')).toBe('a_b_c_d.edited.stage');
  });

  it('falls back to deck for empty names', () => {
    expect(editedStageFilename('')).toBe('deck.edited.stage');
    expect(editedStageFilename('.stage')).toBe('deck.edited.stage');
  });
});
