import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  HIGHLIGHTER_WIDTH,
  PEN_WIDTH,
  toHighlighterColor,
  type PenColor,
  type Point,
  type Stroke,
  type Tool,
} from './types';

interface AnnotationOverlayProps {
  tool: Tool;
  color: PenColor;
  strokes: Stroke[];
  width: number;
  height: number;
  onCommitStroke: (stroke: Stroke) => void;
  onErase: (point: Point) => void;
  onDraftChange?: (draft: Stroke | null) => void;
}

function resolveStrokeStyle(
  tool: 'pen' | 'highlighter',
  color: PenColor,
): { color: string; width: number } {
  if (tool === 'highlighter') {
    return { color: toHighlighterColor(color), width: HIGHLIGHTER_WIDTH };
  }
  return { color, width: PEN_WIDTH };
}

function pointFromEvent(event: PointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const viewBox = event.currentTarget.viewBox.baseVal;
  return {
    x: ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: ((event.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function pointsToPath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function AnnotationOverlay({
  tool,
  color,
  strokes,
  width,
  height,
  onCommitStroke,
  onErase,
  onDraftChange,
}: AnnotationOverlayProps) {
  const [draft, setDraft] = useState<Stroke | null>(null);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const isDrawingTool = tool === 'pen' || tool === 'highlighter';
  const capturesPointer = tool !== 'mouse' && tool !== 'blackout' && tool !== 'whiteout';

  const publishDraft = useCallback((next: Stroke | null) => {
    setDraft(next);
    onDraftChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    if (!draft) return;
    if (draft.tool === tool) return;
    publishDraft(null);
  }, [draft, publishDraft, tool]);

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!isDrawingTool) {
      if (tool === 'eraser') {
        onErase(pointFromEvent(event));
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const style = resolveStrokeStyle(tool, color);
    publishDraft({
      tool,
      color: style.color,
      width: style.width,
      points: [pointFromEvent(event)],
    });
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    // Erase only while a button/contact is actually down — merely hovering
    // the slide with the eraser selected must not wipe annotations.
    if (tool === 'eraser' && event.buttons !== 0) {
      onErase(point);
    }

    if (!draft) {
      return;
    }
    publishDraft({ ...draft, points: [...draft.points, point] });
  };

  const finishDraft = () => {
    if (draft && draft.points.length > 1) {
      onCommitStroke(draft);
    }
    publishDraft(null);
  };

  return (
    <svg
      className={capturesPointer ? 'annotation-overlay active' : 'annotation-overlay idle'}
      data-testid="annotation-overlay"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDraft}
      onPointerCancel={finishDraft}
    >
      {strokes.map((stroke, index) => (
        <path
          key={index}
          d={pointsToPath(stroke.points)}
          fill="none"
          stroke={stroke.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={stroke.width}
        />
      ))}
      {draft ? (
        <path
          d={pointsToPath(draft.points)}
          fill="none"
          stroke={draft.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={draft.width}
        />
      ) : null}
    </svg>
  );
}
