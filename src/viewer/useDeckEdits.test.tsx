/**
 * Unsaved-edit lifecycle contract for `useDeckEdits`.
 *
 * `unsaved` drives the exit reminders (beforeunload / desktop close +
 * quit interception / deck-close confirm), so its transitions are pinned:
 *   - raised by the first committed edit of a session,
 *   - lowered when every patch is chained back to the original text,
 *   - lowered by a successful export, kept by a cancelled save dialog,
 *   - lowered by a discard.
 */
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedDeck, Manifest } from '@slidestage/core/deck/types';
import { I18nProvider } from '@slidestage/lite-preset/i18n/I18nProvider';
import { useDeckEdits } from '@slidestage/lite-preset/viewer/useDeckEdits';

const saveStageFile = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@slidestage/lite-preset/export/downloadStage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@slidestage/lite-preset/export/downloadStage')>()),
  saveStageFile,
}));

vi.mock('@slidestage/lite-preset/export/exportEditedStage', () => ({
  buildEditedStageBytes: vi.fn(() => ({
    bytes: new Uint8Array([0x50, 0x4b]),
    applied: 1,
    failed: 0,
  })),
}));

function makeDeck(): LoadedDeck {
  const manifest: Manifest = {
    schema: 'slidestage@1.0',
    id: 'deck',
    version: '0.0.0',
    title: 'Test',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 1,
    slides: [
      {
        index: 1,
        id: 'one',
        label: 'First',
        file: 'slides/01.html',
        thumbnail: null,
        notes: null,
      },
    ],
  };
  return {
    fileName: 'deck.stage',
    fingerprint: 'fp-edits',
    deckId: 'fpedits',
    manifest,
    slideUrls: ['/__stage/fpedits/slides/01.html'],
    slideHtml: ['<!doctype html><body></body>'],
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    thumbnailUrls: [null],
    prefersSrcdoc: false,
    revoke: vi.fn(),
  };
}

const H1 = 'body>main:nth-of-type(1)>h1:nth-of-type(1)';

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function renderDeckEdits() {
  const file = new File([new Uint8Array([0x50, 0x4b])], 'deck.stage');
  return renderHook(
    () =>
      useDeckEdits({
        deck: makeDeck(),
        getSourceFile: () => file,
        onRequestReload: vi.fn(),
      }),
    { wrapper },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  saveStageFile.mockClear();
  saveStageFile.mockResolvedValue(true);
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDeckEdits — unsaved lifecycle', () => {
  it('starts clean and raises unsaved on the first committed edit', () => {
    const { result } = renderDeckEdits();
    expect(result.current.unsaved).toBe(false);
    act(() => result.current.onEdit(0, { selector: H1, before: 'Old', after: 'New' }));
    expect(result.current.unsaved).toBe(true);
    expect(result.current.hasEdits).toBe(true);
  });

  it('lowers unsaved when the only edit is chained back to the original', () => {
    const { result } = renderDeckEdits();
    act(() => result.current.onEdit(0, { selector: H1, before: 'Old', after: 'New' }));
    act(() => result.current.onEdit(0, { selector: H1, before: 'New', after: 'Old' }));
    expect(result.current.hasEdits).toBe(false);
    expect(result.current.unsaved).toBe(false);
  });

  it('clears unsaved after a successful export', async () => {
    const { result } = renderDeckEdits();
    act(() => result.current.onEdit(0, { selector: H1, before: 'Old', after: 'New' }));
    act(() => result.current.onExportCopy());
    await waitFor(() => expect(result.current.exportBusy).toBe(false));
    expect(saveStageFile).toHaveBeenCalledTimes(1);
    expect(result.current.unsaved).toBe(false);
    // The edits themselves stay recorded — only the reminder is settled.
    expect(result.current.hasEdits).toBe(true);
  });

  it('keeps unsaved raised when the save dialog is cancelled', async () => {
    saveStageFile.mockResolvedValue(false);
    const { result } = renderDeckEdits();
    act(() => result.current.onEdit(0, { selector: H1, before: 'Old', after: 'New' }));
    act(() => result.current.onExportCopy());
    await waitFor(() => expect(result.current.exportBusy).toBe(false));
    expect(result.current.unsaved).toBe(true);
  });

  it('keeps unsaved raised when the export fails', async () => {
    saveStageFile.mockRejectedValue(new Error('disk full'));
    const { result } = renderDeckEdits();
    act(() => result.current.onEdit(0, { selector: H1, before: 'Old', after: 'New' }));
    act(() => result.current.onExportCopy());
    await waitFor(() => expect(result.current.exportBusy).toBe(false));
    expect(result.current.exportError).toBe('disk full');
    expect(result.current.unsaved).toBe(true);
    // The visible failure notice can be dismissed without touching edits.
    act(() => result.current.onDismissExportError());
    expect(result.current.exportError).toBeNull();
    expect(result.current.unsaved).toBe(true);
  });

  it('clears unsaved on discard', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderDeckEdits();
    act(() => result.current.onEdit(0, { selector: H1, before: 'Old', after: 'New' }));
    act(() => result.current.onDiscard());
    expect(result.current.hasEdits).toBe(false);
    expect(result.current.unsaved).toBe(false);
  });

  it('records text-run edits (textNode) like any other target', () => {
    const { result } = renderDeckEdits();
    act(() =>
      result.current.onEdit(0, {
        selector: H1,
        before: '投资组合',
        after: '资产配置',
        textNode: 0,
      }),
    );
    expect(result.current.editCount).toBe(1);
    expect(result.current.unsaved).toBe(true);
  });
});
