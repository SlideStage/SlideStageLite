/**
 * Render contract for the package-owned `<Toolbar />`.
 *
 * The Toolbar moved to `@slidestage/ui/presenter/Toolbar` in Phase 3.5
 * and switched from Lite's `useI18n()` to UI's `useUiTranslator()`. These
 * tests pin two flavours (auto-hide bar and right-dock) and verify the
 * provider override path so we'd catch a regression where the toolbar
 * silently fell back to identity translations inside the Lite app.
 *
 * We don't try to lock in animation timers, hover behaviour, or the
 * spotlight slider — those belong in dedicated tests if/when they regress.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '@slidestage/ui/presenter/Toolbar';
import {
  UiTranslatorProvider,
  type UiTranslator,
} from '@slidestage/ui/i18n/translator';
import type { PresenterApi } from '@slidestage/ui/presenter/usePresenter';
import type { PresenterState } from '@slidestage/ui/presenter/types';

afterEach(() => {
  cleanup();
});

// jsdom doesn't supply ResizeObserver and some browser APIs the toolbar
// touches indirectly. The toolbar itself doesn't need ResizeObserver but
// the surrounding test environment can; install a polyfill to be safe.
beforeAll(() => {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class FakeResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
  }
});

function makeState(overrides: Partial<PresenterState> = {}): PresenterState {
  return {
    tool: 'mouse',
    penColor: '#FF3B30',
    strokesByIdx: {},
    spotlightRadius: 180,
    ...overrides,
  };
}

function makePresenter(state: PresenterState = makeState()): {
  api: PresenterApi;
  spies: {
    setTool: ReturnType<typeof vi.fn>;
    setColor: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    clearSlide: ReturnType<typeof vi.fn>;
    setSpotlightRadius: ReturnType<typeof vi.fn>;
  };
} {
  const setTool = vi.fn();
  const setColor = vi.fn();
  const undo = vi.fn();
  const clearSlide = vi.fn();
  const setSpotlightRadius = vi.fn();
  const api: PresenterApi = {
    state,
    setTool,
    setColor,
    loadStrokes: vi.fn(),
    appendStroke: vi.fn(),
    replaceSlideStrokes: vi.fn(),
    undo,
    clearSlide,
    setSpotlightRadius,
    nudgeSpotlightRadius: vi.fn(),
    isDrawingTool: state.tool === 'pen' || state.tool === 'highlighter' || state.tool === 'eraser',
    needsPointerCapture: false,
  };
  return { api, spies: { setTool, setColor, undo, clearSlide, setSpotlightRadius } };
}

describe('<Toolbar /> right-dock', () => {
  it('renders the full tool roster with identity-fallback labels', () => {
    const { api } = makePresenter();
    render(<Toolbar presenter={api} slideIdx={0} mode="right-dock" />);

    // All eight tools exist via stable data-testid hooks.
    const toolIds = ['mouse', 'laser', 'pen', 'highlighter', 'eraser', 'spotlight', 'blackout', 'whiteout'];
    for (const id of toolIds) {
      expect(screen.getAllByTestId(`tool-${id}`).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('tool-undo')).toBeTruthy();
    expect(screen.getByTestId('tool-clear')).toBeTruthy();
  });

  it('switches tool on click', () => {
    const { api, spies } = makePresenter();
    render(<Toolbar presenter={api} slideIdx={3} mode="right-dock" />);
    fireEvent.click(screen.getByTestId('tool-pen'));
    expect(spies.setTool).toHaveBeenCalledWith('pen');
  });

  it('toggles back to mouse when clicking the active non-mouse tool', () => {
    const { api, spies } = makePresenter(makeState({ tool: 'pen' }));
    render(<Toolbar presenter={api} slideIdx={0} mode="right-dock" />);
    fireEvent.click(screen.getByTestId('tool-pen'));
    expect(spies.setTool).toHaveBeenCalledWith('mouse');
  });

  it('fires undo / clearSlide with the active slide index', () => {
    const { api, spies } = makePresenter();
    render(<Toolbar presenter={api} slideIdx={2} mode="right-dock" />);
    fireEvent.click(screen.getByTestId('tool-undo'));
    fireEvent.click(screen.getByTestId('tool-clear'));
    expect(spies.undo).toHaveBeenCalledWith(2);
    expect(spies.clearSlide).toHaveBeenCalledWith(2);
  });

  it('renders the spotlight size slider only when the spotlight tool is active', () => {
    const { api: idleApi } = makePresenter();
    const { container: idle } = render(
      <Toolbar presenter={idleApi} slideIdx={0} mode="right-dock" />,
    );
    expect(idle.querySelector('[data-testid="spotlight-size-slider"]')).toBeNull();
    cleanup();

    const { api: spotApi } = makePresenter(makeState({ tool: 'spotlight', spotlightRadius: 200 }));
    render(<Toolbar presenter={spotApi} slideIdx={0} mode="right-dock" />);
    const slider = screen.getByTestId('spotlight-size-slider') as HTMLInputElement;
    expect(slider.value).toBe('200');
  });
});

describe('<Toolbar /> auto-hide', () => {
  it('renders compact buttons (no <span class="tool-label">)', () => {
    const { api } = makePresenter();
    const { container } = render(<Toolbar presenter={api} slideIdx={0} mode="auto-hide" />);
    expect(container.querySelector('[data-mode="auto-hide"]')).not.toBeNull();
    expect(container.querySelector('.tool-label')).toBeNull();
  });

  it('shows color swatches only when in pen or highlighter mode', () => {
    const { api: mouseApi } = makePresenter();
    const { container: mouseContainer } = render(
      <Toolbar presenter={mouseApi} slideIdx={0} mode="auto-hide" />,
    );
    expect(mouseContainer.querySelectorAll('.color-swatch')).toHaveLength(0);
    cleanup();

    const { api: penApi } = makePresenter(makeState({ tool: 'pen' }));
    render(<Toolbar presenter={penApi} slideIdx={0} mode="auto-hide" />);
    const swatches = document.querySelectorAll('.color-swatch');
    expect(swatches).toHaveLength(5);
  });
});

describe('<Toolbar /> with a UiTranslatorProvider', () => {
  it('shows injected translations on aria-label / handle / undo button', () => {
    const inject: UiTranslator = {
      t: (key) => {
        const map: Record<string, string> = {
          'toolbar.aria': '演讲工具',
          'toolbar.handle.fallback': '工具',
          'toolbar.handle.expand': '展开',
          'toolbar.handle.collapse': '收起',
          'toolbar.tool.pointer': '鼠标',
          'toolbar.tool.pen': '画笔',
          'toolbar.tool.undo': '撤销',
          'toolbar.tool.clear': '清除',
          'toolbar.tip.undo': '撤销提示',
          'toolbar.tip.clear': '清除提示',
        };
        return map[key] ?? key;
      },
      tFormat: (key, vars) => {
        if (key === 'toolbar.tip.tool') {
          return `${vars?.label ?? ''}（${vars?.shortcut ?? ''}）`;
        }
        return key;
      },
    };
    const { api } = makePresenter();
    render(
      <UiTranslatorProvider value={inject}>
        <Toolbar presenter={api} slideIdx={0} mode="right-dock" />
      </UiTranslatorProvider>,
    );
    expect(screen.getByRole('toolbar').getAttribute('aria-label')).toBe('演讲工具');
    expect(screen.getByTestId('tool-undo').getAttribute('aria-label')).toBe('撤销');
    // tFormat substitution still happens through the injected translator
    expect(screen.getByTestId('tool-pen').getAttribute('title')).toBe('画笔（Shift+P）');
  });
});
