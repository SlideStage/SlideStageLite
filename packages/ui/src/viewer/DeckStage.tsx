import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { BASE_SANDBOX_TOKEN } from '@slidestage/core/deck/trustCapabilities';
import { useStageLayout } from './useStageLayout';

/**
 * Pull keyboard focus back to the outer container.
 *
 * We do this in three places so the App-level `keydown` listener keeps
 * receiving Arrow / PageUp / Space even when WKWebView's tendency to
 * park focus inside the slide iframe would otherwise swallow them:
 *
 *  1. After every iframe `load` (the page just navigated, focus needs
 *     to come back to the host shell).
 *  2. On pointerdown on the outer container (user clicked the
 *     letterbox / non-iframe chrome — they're "back" in the host UI).
 *  3. When the host window regains focus from another app
 *     (`window.addEventListener('focus', …)` — see the effect below).
 *
 * SlideStage deliberately does NOT register OS-level global shortcuts
 * to paper over iframe focus theft. That would steal keys from other
 * apps when SlideStage isn't focused, and ship a Mac App Store
 * entitlement we'd rather not request. Window-scoped focus is the
 * source of truth: when this window has focus, presentation shortcuts
 * must work.
 */
function pullFocusToContainer(container: HTMLElement | null): void {
  if (!container) return;
  try {
    container.focus({ preventScroll: true });
  } catch {
    // Older WebKit versions might not understand the focus options bag;
    // fall back to the plain call.
    try {
      container.focus();
    } catch {
      // ignore
    }
  }
}

interface DeckStageProps {
  src: string;
  title: string;
  width: number;
  height: number;
  preloadSrcs?: string[];
  testId?: string;
  /**
   * Iframe `sandbox` attribute. Defaults to the minimal `allow-scripts`
   * baseline; callers pass an elevated token list after a trust grant.
   */
  sandbox?: string;
  /**
   * Per-slide HTML for the active slide. When provided, we render the
   * iframe with `srcdoc` instead of `src` so Tauri's WKWebView host
   * doesn't have to navigate an iframe to a `blob:tauri://...` URL
   * (which the macOS WKWebView refuses to load under the custom
   * `tauri://` scheme, leaving the deck area white).
   *
   * Preload sibling slides keep using `src`/`preloadSrcs` because they
   * never become the active iframe; rendering them via srcdoc would
   * just inflate the DOM with hot HTML strings.
   */
  srcdoc?: string;
  children?: ReactNode;
}

export function DeckStage({
  src,
  title,
  width,
  height,
  preloadSrcs = [],
  testId = 'deck-stage',
  sandbox = BASE_SANDBOX_TOKEN,
  srcdoc,
  children,
}: DeckStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layout = useStageLayout(containerRef, width, height);
  const frameSrcs = Array.from(new Set([src, ...preloadSrcs].filter(Boolean))).slice(0, 3);

  const handleIframeLoad = useCallback(() => {
    pullFocusToContainer(containerRef.current);
  }, []);

  const handlePointerDown = useCallback(() => {
    // Mouse / touch interactions on slide content can also push focus
    // into the iframe; recover it on the very next frame.
    requestAnimationFrame(() => pullFocusToContainer(containerRef.current));
  }, []);

  // When the host window regains focus (Alt/Cmd-Tab, clicking the
  // SlideStage window after working in another app, dismissing a system
  // dialog), pull focus back to the deck container so presentation
  // shortcuts are available immediately. This is the primary mechanism
  // that lets us rely on window-scoped shortcuts instead of OS-level
  // ones.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onWindowFocus = (): void => {
      requestAnimationFrame(() =>
        pullFocusToContainer(containerRef.current),
      );
    };
    window.addEventListener('focus', onWindowFocus);
    return () => {
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="stage-card"
      style={{ aspectRatio: `${width} / ${height}` }}
      data-testid={testId}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
    >
      <div
        className="logical-stage"
        style={{
          width,
          height,
          left: layout.offsetX,
          top: layout.offsetY,
          transform: `scale(${layout.scale})`,
        }}
      >
        {frameSrcs.map((frameSrc) => {
          const isActive = frameSrc === src;
          const useSrcdoc = isActive && typeof srcdoc === 'string';
          return (
            <iframe
              key={useSrcdoc ? `srcdoc:${frameSrc}` : frameSrc}
              title={isActive ? title : 'preloaded slide'}
              {...(useSrcdoc ? { srcDoc: srcdoc } : { src: frameSrc })}
              sandbox={sandbox}
              referrerPolicy="no-referrer"
              data-active={isActive ? 'true' : 'false'}
              onLoad={isActive ? handleIframeLoad : undefined}
            />
          );
        })}
        {children}
      </div>
    </div>
  );
}
