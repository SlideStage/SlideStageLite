import { useMemo } from 'react';
import { renderMarkdownToSafeHtml } from './renderMarkdown';

export interface MarkdownViewProps {
  /**
   * Raw markdown source. `null` / `undefined` / empty string all render
   * `null` so callers can supply their own empty-state UI without an
   * extra wrapping element.
   */
  source: string | null | undefined;
  /**
   * Optional class appended after `markdown-body`. Hosts use this to
   * scope colors / spacing to a specific panel.
   */
  className?: string;
  /**
   * Test hook forwarded as `data-testid` for vitest selectors. Existing
   * tests pin the speaker-notes / presenter-notes test ids, so this is
   * a pass-through escape hatch.
   */
  testId?: string;
}

/**
 * Render speaker-notes Markdown into a styled, sanitized HTML block.
 *
 * The actual parsing happens in `renderMarkdownToSafeHtml`, which is a
 * pure function. Memoizing on `source` avoids re-parsing on every
 * unrelated re-render of the host (slide changes happen often).
 *
 * The output is injected via `dangerouslySetInnerHTML`: that is the
 * standard React idiom for inline HTML, and the renderer's own contract
 * is "every code path either escapes raw user input or emits a tag from
 * a finite hardcoded allowlist". See `renderMarkdown.ts` for the
 * security model.
 */
export function MarkdownView({ source, className, testId }: MarkdownViewProps) {
  const html = useMemo(() => renderMarkdownToSafeHtml(source), [source]);
  if (!html) return null;
  const cls = className ? `markdown-body ${className}` : 'markdown-body';
  return (
    <div
      className={cls}
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
