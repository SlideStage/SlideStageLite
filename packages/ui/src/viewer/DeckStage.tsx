import { useCallback, useRef, type ReactNode } from 'react';
import { BASE_SANDBOX_TOKEN } from '@slidestage/core/deck/trustCapabilities';
import { useStageLayout } from './useStageLayout';

/**
 * Pull keyboard focus back to the outer container after a slide iframe
 * loads. Otherwise WKWebView (Tauri) parks focus inside the iframe and
 * the top-level `window.addEventListener('keydown', ...)` in App.tsx
 * never sees Arrow / PageUp / Space. Doing this every load is cheap and
 * works for both the Web and Desktop builds.
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
