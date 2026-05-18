import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CircleDot,
  Eraser,
  Highlighter,
  MousePointer2,
  PanelRightOpen,
  PenLine,
  RotateCcw,
  Spotlight,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import {
  PEN_COLORS,
  SPOTLIGHT_MAX_RADIUS,
  SPOTLIGHT_MIN_RADIUS,
  SPOTLIGHT_STEP,
  toHighlighterColor,
  type PenColor,
  type Tool,
} from './types';
import type { PresenterApi } from './usePresenter';

export type ToolbarMode = 'auto-hide' | 'right-dock';

interface ToolbarProps {
  presenter: PresenterApi;
  slideIdx: number;
  mode?: ToolbarMode;
  hostRef?: RefObject<HTMLElement | null>;
}

interface ToolDef {
  id: Tool;
  /** i18n key suffix, e.g. `pointer` → `toolbar.tool.pointer`. */
  labelKey: string;
  /** Hard-coded shortcut hint (rendered verbatim across locales). */
  shortcut: string;
  icon: LucideIcon;
}

const TOOL_DEFS: ToolDef[] = [
  { id: 'mouse', labelKey: 'toolbar.tool.pointer', shortcut: 'Shift+M / Esc', icon: MousePointer2 },
  { id: 'laser', labelKey: 'toolbar.tool.laser', shortcut: 'Shift+L', icon: CircleDot },
  { id: 'pen', labelKey: 'toolbar.tool.pen', shortcut: 'Shift+P', icon: PenLine },
  { id: 'highlighter', labelKey: 'toolbar.tool.highlighter', shortcut: 'Shift+H', icon: Highlighter },
  { id: 'eraser', labelKey: 'toolbar.tool.eraser', shortcut: 'Shift+E', icon: Eraser },
  { id: 'spotlight', labelKey: 'toolbar.tool.spotlight', shortcut: 'Shift+S', icon: Spotlight },
  { id: 'blackout', labelKey: 'toolbar.tool.black', shortcut: 'B', icon: Square },
  { id: 'whiteout', labelKey: 'toolbar.tool.white', shortcut: 'W', icon: Square },
];

const COLLAPSE_DELAY_MS = 450;
const AUTOHIDE_REVEAL_RATIO = 0.6;
const AUTOHIDE_AFTER_MS = 2000;

function getDisplayedColor(tool: Tool, color: PenColor): string {
  return tool === 'highlighter' ? toHighlighterColor(color) : color;
}

export function Toolbar({ presenter, slideIdx, mode = 'right-dock', hostRef }: ToolbarProps) {
  const { state, setTool, setColor, setSpotlightRadius, undo, clearSlide } = presenter;
  const { t, tFormat } = useI18n();
  const isDock = mode === 'right-dock';
  const [visible, setVisible] = useState(!isDock);
  const [expanded, setExpanded] = useState(false);
  const hoveredRef = useRef(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tools = useMemo(
    () => TOOL_DEFS.map((def) => ({ ...def, label: t(def.labelKey) })),
    [t],
  );

  const isDrawing = state.tool === 'pen' || state.tool === 'highlighter' || state.tool === 'eraser';
  const isColorContext = state.tool === 'pen' || state.tool === 'highlighter';
  const isSpotlight = state.tool === 'spotlight';
  const activeTool = tools.find((tool) => tool.id === state.tool);
  const ActiveToolIcon = activeTool?.icon;
  const isMouseTool = state.tool === 'mouse';
  const HandleIcon = !isMouseTool && ActiveToolIcon ? ActiveToolIcon : PanelRightOpen;
  const handleLabel =
    !isMouseTool && activeTool ? activeTool.label.toUpperCase() : t('toolbar.handle.fallback');
  const activeDrawingColor = getDisplayedColor(state.tool, state.penColor);
  const showHandleColorDot = !expanded && isColorContext;

  function cancelCollapse(): void {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }

  function scheduleCollapse(): void {
    cancelCollapse();
    collapseTimerRef.current = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS);
  }

  useEffect(() => {
    setVisible(!isDock);
    setExpanded(false);
    hoveredRef.current = false;
  }, [isDock]);

  useEffect(() => {
    if (!isDock) return;
    if (!hoveredRef.current) {
      scheduleCollapse();
    }
  }, [isDock, state.tool]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isDock) return;
    const node = hostRef?.current;
    if (!node) return;

    function bumpVisible(): void {
      setVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setVisible(false), AUTOHIDE_AFTER_MS);
    }
    function onMove(ev: PointerEvent): void {
      const rect = node!.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      if (y / rect.height >= AUTOHIDE_REVEAL_RATIO) bumpVisible();
    }
    function onLeave(): void {
      if (!isDrawing) setVisible(false);
    }
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    bumpVisible();
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [hostRef, isDrawing, isDock]);

  useEffect(() => {
    if (!isDock && isDrawing) setVisible(true);
  }, [isDrawing, isDock]);

  if (!isDock) {
    return (
      <div
        className={`presenter-toolbar${visible ? '' : ' hidden'}`}
        data-testid="presenter-toolbar"
        data-mode="auto-hide"
        role="toolbar"
        aria-label={t('toolbar.aria')}
      >
        <div className="presenter-toolbar-inner">
          {tools.map((tool) => {
            const isActive = state.tool === tool.id;
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                className={`tool-btn${isActive ? ' active' : ''}`}
                onClick={() => setTool(isActive && tool.id !== 'mouse' ? 'mouse' : tool.id)}
                title={tFormat('toolbar.tip.tool', { label: tool.label, shortcut: tool.shortcut })}
                aria-pressed={isActive}
                aria-label={tool.label}
                data-testid={`tool-${tool.id}`}
              >
                <Icon className={`tool-icon tool-icon-${tool.id}`} aria-hidden size={18} />
              </button>
            );
          })}

          <div className="toolbar-sep" />

          {isColorContext &&
            PEN_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`color-swatch${state.penColor === c ? ' active' : ''}`}
                onClick={() => setColor(c)}
                title={tFormat('toolbar.tip.color', { color: c, n: i + 1 })}
                aria-label={tFormat('toolbar.aria.color', { color: c })}
                data-testid={`color-${i + 1}`}
                style={{ background: getDisplayedColor(state.tool, c) }}
              />
            ))}

          {isSpotlight ? (
            <SpotlightSizeControl
              value={state.spotlightRadius}
              onChange={setSpotlightRadius}
              layout="bar"
            />
          ) : null}

          <div className="toolbar-sep" />

          <button
            type="button"
            className="tool-btn"
            onClick={() => undo(slideIdx)}
            title={t('toolbar.tip.undo')}
            aria-label={t('toolbar.tool.undo')}
            data-testid="tool-undo"
          >
            <RotateCcw className="tool-icon" aria-hidden size={18} />
          </button>
          <button
            type="button"
            className="tool-btn danger"
            onClick={() => clearSlide(slideIdx)}
            title={t('toolbar.tip.clear')}
            aria-label={t('toolbar.tool.clear')}
            data-testid="tool-clear"
          >
            <Trash2 className="tool-icon" aria-hidden size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`presenter-toolbar dock-right ${expanded ? 'expanded' : 'collapsed'}${
        isDrawing ? ' has-active-drawing-tool' : ''
      }`}
      data-testid="presenter-toolbar"
      data-mode="right-dock"
      data-expanded={expanded ? 'true' : 'false'}
      role="toolbar"
      aria-label={t('toolbar.aria')}
      onPointerEnter={() => {
        hoveredRef.current = true;
        cancelCollapse();
        setExpanded(true);
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
        scheduleCollapse();
      }}
    >
      <button
        type="button"
        className="toolbar-handle"
        data-testid="toolbar-handle"
        aria-label={expanded ? t('toolbar.handle.collapse') : t('toolbar.handle.expand')}
        aria-expanded={expanded}
        onClick={() => {
          cancelCollapse();
          setExpanded(true);
        }}
      >
        <HandleIcon
          className={`toolbar-handle-icon${activeTool ? ` tool-icon-${activeTool.id}` : ''}`}
          aria-hidden
          size={18}
        />
        <span className="toolbar-handle-label" data-testid="toolbar-handle-label">
          {handleLabel}
        </span>
        {showHandleColorDot ? (
          <span
            className="toolbar-handle-color"
            data-testid="toolbar-handle-color"
            aria-label={tFormat('toolbar.aria.activeColor', { color: activeDrawingColor })}
            style={{ background: activeDrawingColor }}
          />
        ) : null}
      </button>

      <div className="presenter-toolbar-inner dock-inner">
        {tools.map((tool) => {
          const isActive = state.tool === tool.id;
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              className={`tool-btn${isActive ? ' active' : ''}`}
              onClick={() => setTool(isActive && tool.id !== 'mouse' ? 'mouse' : tool.id)}
              title={tFormat('toolbar.tip.tool', { label: tool.label, shortcut: tool.shortcut })}
              aria-pressed={isActive}
              aria-label={tool.label}
              data-testid={`tool-${tool.id}`}
            >
              <Icon className={`tool-icon tool-icon-${tool.id}`} aria-hidden size={18} />
              <span className="tool-label">{tool.label}</span>
            </button>
          );
        })}

        <div className="toolbar-sep" />

        <div className="color-swatch-row">
          {PEN_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`color-swatch${state.penColor === c ? ' active' : ''}${
                isColorContext ? '' : ' dim'
              }`}
              onClick={() => setColor(c)}
              title={tFormat('toolbar.tip.color', { color: c, n: i + 1 })}
              aria-label={tFormat('toolbar.aria.color', { color: c })}
              data-testid={`color-${i + 1}`}
              style={{ background: getDisplayedColor(state.tool, c) }}
            />
          ))}
        </div>

        {isSpotlight ? (
          <>
            <div className="toolbar-sep" />
            <SpotlightSizeControl value={state.spotlightRadius} onChange={setSpotlightRadius} />
          </>
        ) : null}

        <div className="toolbar-sep" />

        <button
          type="button"
          className="tool-btn"
          onClick={() => undo(slideIdx)}
          title={t('toolbar.tip.undo')}
          aria-label={t('toolbar.tool.undo')}
          data-testid="tool-undo"
        >
          <RotateCcw className="tool-icon" aria-hidden size={18} />
          <span className="tool-label">{t('toolbar.tool.undo')}</span>
        </button>
        <button
          type="button"
          className="tool-btn danger"
          onClick={() => clearSlide(slideIdx)}
          title={t('toolbar.tip.clear')}
          aria-label={t('toolbar.tool.clear')}
          data-testid="tool-clear"
        >
          <Trash2 className="tool-icon" aria-hidden size={18} />
          <span className="tool-label">{t('toolbar.tool.clear')}</span>
        </button>
      </div>
    </div>
  );
}

interface SpotlightSizeControlProps {
  value: number;
  onChange: (next: number) => void;
  layout?: 'dock' | 'bar';
}

function SpotlightSizeControl({ value, onChange, layout = 'dock' }: SpotlightSizeControlProps) {
  const { t, tFormat } = useI18n();
  return (
    <div
      className={`spotlight-size-control spotlight-size-control-${layout}`}
      data-testid="spotlight-size-control"
    >
      {layout === 'dock' ? (
        <div className="spotlight-size-label" aria-hidden>
          {t('toolbar.spotlight.size')}
        </div>
      ) : null}
      <input
        type="range"
        min={SPOTLIGHT_MIN_RADIUS}
        max={SPOTLIGHT_MAX_RADIUS}
        step={SPOTLIGHT_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="spotlight-size-slider"
        aria-label={tFormat('toolbar.spotlight.aria', { n: value })}
        data-testid="spotlight-size-slider"
      />
      <div className="spotlight-size-value" data-testid="spotlight-size-value" aria-hidden>
        {value}
        <span className="spotlight-size-unit">px</span>
      </div>
    </div>
  );
}
