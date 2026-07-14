import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import type { SlideEdit } from '@slidestage/ui/presenter/slideRuntime';
import type { DeckViewerEditingApi } from '@slidestage/ui/viewer/DeckViewer';
import { useI18n } from '../i18n/I18nProvider';
import {
  clearDeckEdits,
  countDeckEdits,
  loadDeckEdits,
  saveDeckEdits,
  upsertDeckEdit,
  type StoredDeckEdits,
} from '../persistence/editsStore';
import { buildEditedStageBytes } from '../export/exportEditedStage';
import { editedStageFilename, saveStageFile } from '../export/downloadStage';

export interface UseDeckEditsOptions {
  deck: LoadedDeck;
  /**
   * Returns the original `File` the deck was opened from (kept by
   * LiteApp). Needed to bake edits into an exported copy and to silently
   * reload the deck after an edit session.
   */
  getSourceFile: () => File | null;
  /**
   * Reload the current deck in place (same bytes → same fingerprint →
   * trust/annotations untouched) so every render surface — presenter
   * iframes, audience window, thumbnails, PDF export — picks up the
   * patched slide HTML.
   */
  onRequestReload: () => Promise<void> | void;
}

/**
 * Edit-session state for the lite DeckViewer: hydrates stored patches per
 * deck fingerprint, records agent-reported edits (chaining same-element
 * edits, enforcing the store budget), and drives export / discard / the
 * exit-reload.
 */
export function useDeckEdits({
  deck,
  getSourceFile,
  onRequestReload,
}: UseDeckEditsOptions): DeckViewerEditingApi {
  const { t } = useI18n();

  const [active, setActive] = useState(false);
  const [edits, setEdits] = useState<StoredDeckEdits>({});
  const [storageFull, setStorageFull] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Mirrors kept in refs so callbacks stay stable and StrictMode's
  // double-invoked updaters never double-fire side effects (persist,
  // reload).
  const activeRef = useRef(false);
  const editsRef = useRef<StoredDeckEdits>({});
  const dirtyRef = useRef(false);
  const getSourceFileRef = useRef(getSourceFile);
  getSourceFileRef.current = getSourceFile;
  const onRequestReloadRef = useRef(onRequestReload);
  onRequestReloadRef.current = onRequestReload;

  // Hydrate per deck identity. A silent reload keeps the fingerprint, so
  // the running edit session (active flag, dirty state) survives it.
  useEffect(() => {
    const hydrated = loadDeckEdits(deck.fingerprint);
    editsRef.current = hydrated;
    setEdits(hydrated);
    activeRef.current = false;
    setActive(false);
    dirtyRef.current = false;
    setStorageFull(false);
    setExportBusy(false);
    setExportError(null);
  }, [deck.fingerprint]);

  const onEdit = useCallback(
    (slideIndex: number, edit: SlideEdit) => {
      const { edits: next, rejected } = upsertDeckEdit(editsRef.current, slideIndex, edit);
      if (rejected === 'cap') {
        setStorageFull(true);
        return;
      }
      if (next === editsRef.current) return;
      editsRef.current = next;
      dirtyRef.current = true;
      setEdits(next);
      setStorageFull(!saveDeckEdits(deck.fingerprint, next));
    },
    [deck.fingerprint],
  );

  const onToggle = useCallback(() => {
    const next = !activeRef.current;
    activeRef.current = next;
    setActive(next);
    // Leaving edit mode with committed changes: silently reload so every
    // render surface (both windows, thumbnails, PDF) shows the patched
    // HTML, not just the live-edited presenter iframe.
    if (!next && dirtyRef.current) {
      dirtyRef.current = false;
      void onRequestReloadRef.current?.();
    }
  }, []);

  const onDiscard = useCallback(() => {
    if (typeof window !== 'undefined' && !window.confirm(t('viewer.editing.discardConfirm'))) {
      return;
    }
    clearDeckEdits(deck.fingerprint);
    editsRef.current = {};
    setEdits({});
    setStorageFull(false);
    setExportError(null);
    dirtyRef.current = false;
    void onRequestReloadRef.current?.();
  }, [deck.fingerprint, t]);

  const onExportCopy = useCallback(() => {
    void (async () => {
      setExportBusy(true);
      setExportError(null);
      try {
        const file = getSourceFileRef.current();
        if (!file) throw new Error(t('errors.editExport'));
        const source = new Uint8Array(await file.arrayBuffer());
        const result = buildEditedStageBytes(source, deck.manifest, editsRef.current);
        await saveStageFile(result.bytes, editedStageFilename(deck.fileName));
      } catch (err) {
        setExportError(err instanceof Error ? err.message : t('errors.editExport'));
      } finally {
        setExportBusy(false);
      }
    })();
  }, [deck.fileName, deck.manifest, t]);

  const editCount = useMemo(() => countDeckEdits(edits), [edits]);

  return {
    active,
    onToggle,
    onEdit,
    hasEdits: editCount > 0,
    editCount,
    onExportCopy,
    exportBusy,
    exportError,
    onDiscard,
    storageFull,
  };
}
