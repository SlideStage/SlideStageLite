import { type RefObject } from 'react';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import { useUiTranslator } from '../i18n/translator';
import { AnnotationOverlay } from '../presenter/AnnotationOverlay';
import { Blackout } from '../presenter/Blackout';
import { LaserPointer } from '../presenter/LaserPointer';
import { Spotlight } from '../presenter/Spotlight';
import { Toolbar, type ToolbarMode } from '../presenter/Toolbar';
import type { Point, Stroke } from '../presenter/types';
import type { PresenterApi } from '../presenter/usePresenter';
import type { AudiencePointer } from '../presenter/usePresentationSync';
import { DeckStage } from './DeckStage';

export interface PresenterStageBlockProps {
  /**
   * Ref to the wrapping `.presenter-host`. The Toolbar's auto-hide
   * mode needs to bind pointermove listeners on this host. The owning
   * DeckViewer also reads this ref to derive `useAudiencePointerTracking`.
   */
  hostRef: RefObject<HTMLDivElement | null>;
  deck: LoadedDeck;
  currentIndex: number;
  iframeSandbox?: string;
  /** When true, the active slide iframe is mounted via `srcdoc`. */
  useSrcdoc: boolean;
  /** Sibling slide URLs to prefetch (only used when `useSrcdoc` is false). */
  preloadSrcs: ReadonlyArray<string>;
  presenter: PresenterApi;
  audiencePointer: AudiencePointer | null;
  onAppendStroke: (stroke: Stroke) => void;
  onErase: (point: Point) => void;
  onDraftStrokeChange: (stroke: Stroke | null) => void;
  toolbarMode: ToolbarMode;
}

/**
 * Re-usable presenter stage: the slide iframe stack plus annotation /
 * spotlight / laser overlays and the floating toolbar. Used by both
 * single-window and presenter layouts; the only meaningful difference
 * between the two is the Toolbar's mode (right-dock vs auto-hide).
 */
export function PresenterStageBlock({
  hostRef,
  deck,
  currentIndex,
  iframeSandbox,
  useSrcdoc,
  preloadSrcs,
  presenter,
  audiencePointer,
  onAppendStroke,
  onErase,
  onDraftStrokeChange,
  toolbarMode,
}: PresenterStageBlockProps) {
  const { tFormat } = useUiTranslator();
  const slide = deck.manifest.slides[currentIndex];
  const currentStrokes = presenter.state.strokesByIdx[currentIndex] ?? [];
  const currentSlideHtml = useSrcdoc ? deck.slideHtml[currentIndex] : undefined;
  const blackoutColor =
    presenter.state.tool === 'blackout'
      ? '#000'
      : presenter.state.tool === 'whiteout'
        ? '#fff'
        : null;

  return (
    <div className="presenter-host" ref={hostRef} data-testid="presenter-host">
      <DeckStage
        src={deck.slideUrls[currentIndex]}
        srcdoc={currentSlideHtml}
        title={tFormat('viewer.title.current.live', {
          n: slide.index,
          label: slide.label,
        })}
        width={deck.manifest.dimensions.width}
        height={deck.manifest.dimensions.height}
        preloadSrcs={Array.from(preloadSrcs)}
        sandbox={iframeSandbox}
      >
        <AnnotationOverlay
          tool={presenter.state.tool}
          color={presenter.state.penColor}
          strokes={currentStrokes}
          width={deck.manifest.dimensions.width}
          height={deck.manifest.dimensions.height}
          onCommitStroke={onAppendStroke}
          onErase={onErase}
          onDraftChange={onDraftStrokeChange}
        />
        <Spotlight
          active={presenter.state.tool === 'spotlight'}
          point={audiencePointer?.tool === 'spotlight' ? audiencePointer.point : null}
          radius={presenter.state.spotlightRadius}
          width={deck.manifest.dimensions.width}
          height={deck.manifest.dimensions.height}
        />
        <LaserPointer
          active={presenter.state.tool === 'laser'}
          point={audiencePointer?.tool === 'laser' ? audiencePointer.point : null}
        />
      </DeckStage>
      <Blackout color={blackoutColor} />
      <Toolbar
        presenter={presenter}
        slideIdx={currentIndex}
        mode={toolbarMode}
        hostRef={hostRef}
      />
    </div>
  );
}
