import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  PEN_COLORS,
  SPOTLIGHT_DEFAULT_RADIUS,
  SPOTLIGHT_STEP,
  SPOTLIGHT_STORAGE_KEY,
  clampSpotlightRadius,
  type PenColor,
  type PresenterState,
  type Stroke,
  type Tool,
} from './types';

type Action =
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-color'; color: PenColor }
  | { type: 'load'; strokes: Record<number, Stroke[]> }
  | { type: 'append'; slideIdx: number; stroke: Stroke }
  | { type: 'replace-slide'; slideIdx: number; strokes: Stroke[] }
  | { type: 'undo'; slideIdx: number }
  | { type: 'clear-slide'; slideIdx: number }
  | { type: 'set-spotlight-radius'; radius: number };

function readStoredSpotlightRadius(): number {
  try {
    const raw = localStorage.getItem(SPOTLIGHT_STORAGE_KEY);
    return raw ? clampSpotlightRadius(Number(raw)) : SPOTLIGHT_DEFAULT_RADIUS;
  } catch {
    return SPOTLIGHT_DEFAULT_RADIUS;
  }
}

function initialState(): PresenterState {
  return {
    tool: 'mouse',
    penColor: PEN_COLORS[0],
    strokesByIdx: {},
    spotlightRadius: readStoredSpotlightRadius(),
  };
}

function reducer(state: PresenterState, action: Action): PresenterState {
  switch (action.type) {
    case 'set-tool':
      return { ...state, tool: action.tool };
    case 'set-color':
      return { ...state, penColor: action.color };
    case 'load':
      return { ...state, strokesByIdx: { ...action.strokes } };
    case 'append':
      return {
        ...state,
        strokesByIdx: {
          ...state.strokesByIdx,
          [action.slideIdx]: [...(state.strokesByIdx[action.slideIdx] ?? []), action.stroke],
        },
      };
    case 'replace-slide':
      return {
        ...state,
        strokesByIdx: {
          ...state.strokesByIdx,
          [action.slideIdx]: action.strokes,
        },
      };
    case 'undo':
      return {
        ...state,
        strokesByIdx: {
          ...state.strokesByIdx,
          [action.slideIdx]: (state.strokesByIdx[action.slideIdx] ?? []).slice(0, -1),
        },
      };
    case 'clear-slide':
      return {
        ...state,
        strokesByIdx: {
          ...state.strokesByIdx,
          [action.slideIdx]: [],
        },
      };
    case 'set-spotlight-radius':
      return { ...state, spotlightRadius: clampSpotlightRadius(action.radius) };
    default:
      return state;
  }
}

export interface PresenterApi {
  state: PresenterState;
  setTool: (tool: Tool) => void;
  setColor: (color: PenColor) => void;
  loadStrokes: (strokes: Record<number, Stroke[]>) => void;
  appendStroke: (slideIdx: number, stroke: Stroke) => void;
  replaceSlideStrokes: (slideIdx: number, strokes: Stroke[]) => void;
  undo: (slideIdx: number) => void;
  clearSlide: (slideIdx: number) => void;
  setSpotlightRadius: (radius: number) => void;
  nudgeSpotlightRadius: (delta: number) => void;
  isDrawingTool: boolean;
  needsPointerCapture: boolean;
}

export function usePresenter(): PresenterApi {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const radiusRef = useRef(state.spotlightRadius);
  radiusRef.current = state.spotlightRadius;

  useEffect(() => {
    try {
      localStorage.setItem(SPOTLIGHT_STORAGE_KEY, String(state.spotlightRadius));
    } catch {
      // Ignore private-mode/quota errors.
    }
  }, [state.spotlightRadius]);

  const setTool = useCallback((tool: Tool) => dispatch({ type: 'set-tool', tool }), []);
  const setColor = useCallback((color: PenColor) => dispatch({ type: 'set-color', color }), []);
  const loadStrokes = useCallback((strokes: Record<number, Stroke[]>) => dispatch({ type: 'load', strokes }), []);
  const appendStroke = useCallback(
    (slideIdx: number, stroke: Stroke) => dispatch({ type: 'append', slideIdx, stroke }),
    [],
  );
  const replaceSlideStrokes = useCallback(
    (slideIdx: number, strokes: Stroke[]) => dispatch({ type: 'replace-slide', slideIdx, strokes }),
    [],
  );
  const undo = useCallback((slideIdx: number) => dispatch({ type: 'undo', slideIdx }), []);
  const clearSlide = useCallback((slideIdx: number) => dispatch({ type: 'clear-slide', slideIdx }), []);
  const setSpotlightRadius = useCallback(
    (radius: number) => dispatch({ type: 'set-spotlight-radius', radius }),
    [],
  );
  const nudgeSpotlightRadius = useCallback(
    (delta: number) => dispatch({ type: 'set-spotlight-radius', radius: radiusRef.current + delta }),
    [],
  );

  const isDrawingTool = state.tool === 'pen' || state.tool === 'highlighter' || state.tool === 'eraser';
  const needsPointerCapture = isDrawingTool || state.tool === 'laser' || state.tool === 'spotlight';

  return useMemo(
    () => ({
      state,
      setTool,
      setColor,
      loadStrokes,
      appendStroke,
      replaceSlideStrokes,
      undo,
      clearSlide,
      setSpotlightRadius,
      nudgeSpotlightRadius,
      isDrawingTool,
      needsPointerCapture,
    }),
    [
      appendStroke,
      clearSlide,
      isDrawingTool,
      loadStrokes,
      needsPointerCapture,
      nudgeSpotlightRadius,
      replaceSlideStrokes,
      setColor,
      setSpotlightRadius,
      setTool,
      state,
      undo,
    ],
  );
}

export function usePresenterShortcuts(api: PresenterApi, currentSlideIdx: number) {
  const { state, setTool, setColor, undo, clearSlide, nudgeSpotlightRadius } = api;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const key = event.key;
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo(currentSlideIdx);
        return;
      }
      if (event.shiftKey && (key === 'Delete' || key === 'Backspace')) {
        event.preventDefault();
        clearSlide(currentSlideIdx);
        return;
      }
      if (event.shiftKey) {
        const map: Record<string, Tool> = {
          L: 'laser',
          P: 'pen',
          H: 'highlighter',
          E: 'eraser',
          S: 'spotlight',
          M: 'mouse',
        };
        const next = map[key.toUpperCase()];
        if (next) {
          event.preventDefault();
          setTool(next);
          return;
        }
      }
      if (state.tool === 'spotlight' && (key === '[' || key === ']')) {
        event.preventDefault();
        nudgeSpotlightRadius(key === ']' ? SPOTLIGHT_STEP : -SPOTLIGHT_STEP);
        return;
      }
      if (key.toLowerCase() === 'b') {
        event.preventDefault();
        setTool(state.tool === 'blackout' ? 'mouse' : 'blackout');
        return;
      }
      if (key.toLowerCase() === 'w') {
        event.preventDefault();
        setTool(state.tool === 'whiteout' ? 'mouse' : 'whiteout');
        return;
      }
      if (key === 'Escape' && state.tool !== 'mouse') {
        event.preventDefault();
        setTool('mouse');
        return;
      }
      if ((state.tool === 'pen' || state.tool === 'highlighter') && /^[1-5]$/.test(key)) {
        event.preventDefault();
        const color = PEN_COLORS[Number(key) - 1];
        if (color) {
          setColor(color);
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSlide, currentSlideIdx, nudgeSpotlightRadius, setColor, setTool, state.tool, undo]);

  return {
    isToolDigitContext: state.tool === 'pen' || state.tool === 'highlighter',
  };
}
