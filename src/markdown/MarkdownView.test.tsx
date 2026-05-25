/**
 * Contract tests for `<MarkdownView />`. We only assert the rendering
 * envelope here — the markdown-to-html parsing is covered exhaustively
 * by `renderMarkdown.test.ts`.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownView } from '@slidestage/ui/markdown/MarkdownView';

afterEach(() => {
  cleanup();
});

describe('<MarkdownView />', () => {
  it('returns null for empty source', () => {
    const { container } = render(<MarkdownView source="" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for null source', () => {
    const { container } = render(<MarkdownView source={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for whitespace-only source', () => {
    // Use a JS string literal so `\n` becomes a real newline. JSX
    // attribute strings would treat the backslash as a literal char.
    const { container } = render(<MarkdownView source={'   \n '} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders parsed markdown inside a .markdown-body wrapper', () => {
    const { container } = render(<MarkdownView source="**bold**" />);
    const root = container.firstChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.className).toBe('markdown-body');
    expect(root.innerHTML).toContain('<strong>bold</strong>');
  });

  it('appends custom className', () => {
    const { container } = render(<MarkdownView source="hi" className="presenter-notes-body" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toBe('markdown-body presenter-notes-body');
  });

  it('forwards testId as data-testid', () => {
    const { container } = render(<MarkdownView source="hi" testId="notes-md" />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-testid')).toBe('notes-md');
  });

  it('does not inject raw script tags', () => {
    const { container } = render(<MarkdownView source="<script>boom()</script>" />);
    const root = container.firstChild as HTMLElement;
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('boom()');
  });
});
