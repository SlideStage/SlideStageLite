/**
 * Contract tests for the zero-dependency Markdown renderer that powers
 * speaker notes. The renderer is intentionally a GFM *subset*; these
 * tests pin the supported syntax and lock down the security model.
 *
 * Why every test asserts on raw HTML rather than DOM structure: the
 * renderer's output is consumed via `dangerouslySetInnerHTML`, so the
 * exact string is the public contract.
 */
import { describe, expect, it } from 'vitest';
import {
  renderMarkdownToSafeHtml,
  __internal,
} from '@slidestage/ui/markdown/renderMarkdown';

describe('renderMarkdownToSafeHtml — empty / nil', () => {
  it('returns "" for null', () => {
    expect(renderMarkdownToSafeHtml(null)).toBe('');
  });
  it('returns "" for undefined', () => {
    expect(renderMarkdownToSafeHtml(undefined)).toBe('');
  });
  it('returns "" for empty string', () => {
    expect(renderMarkdownToSafeHtml('')).toBe('');
  });
  it('returns "" for whitespace-only string', () => {
    expect(renderMarkdownToSafeHtml('   \n  \n')).toBe('');
  });
});

describe('renderMarkdownToSafeHtml — headings', () => {
  it('renders ATX headings 1-6', () => {
    for (let level = 1; level <= 6; level++) {
      const html = renderMarkdownToSafeHtml(`${'#'.repeat(level)} hello`);
      expect(html).toBe(`<h${level}>hello</h${level}>`);
    }
  });
  it('strips trailing closing #s', () => {
    expect(renderMarkdownToSafeHtml('## title ##')).toBe('<h2>title</h2>');
  });
  it('escapes html inside heading text', () => {
    expect(renderMarkdownToSafeHtml('# <script>x</script>')).toContain('&lt;script&gt;');
  });
});

describe('renderMarkdownToSafeHtml — paragraphs and inline', () => {
  it('renders a plain paragraph', () => {
    expect(renderMarkdownToSafeHtml('hello world')).toBe('<p>hello world</p>');
  });
  it('separates paragraphs by blank lines', () => {
    expect(renderMarkdownToSafeHtml('first\n\nsecond')).toBe(
      '<p>first</p>\n<p>second</p>',
    );
  });
  it('renders **bold**', () => {
    expect(renderMarkdownToSafeHtml('say **hi** now')).toBe(
      '<p>say <strong>hi</strong> now</p>',
    );
  });
  it('renders *italic*', () => {
    expect(renderMarkdownToSafeHtml('say *hi* now')).toBe(
      '<p>say <em>hi</em> now</p>',
    );
  });
  it('renders ~~strikethrough~~', () => {
    expect(renderMarkdownToSafeHtml('~~old~~ news')).toBe('<p><del>old</del> news</p>');
  });
  it('does not treat * as italic when surrounded by spaces (multiplication)', () => {
    expect(renderMarkdownToSafeHtml('5 * 3 = 15')).toBe('<p>5 * 3 = 15</p>');
  });
  it('renders inline code', () => {
    expect(renderMarkdownToSafeHtml('use `pnpm test`')).toBe(
      '<p>use <code>pnpm test</code></p>',
    );
  });
  it('escapes html inside inline code', () => {
    expect(renderMarkdownToSafeHtml('`<script>`')).toBe(
      '<p><code>&lt;script&gt;</code></p>',
    );
  });
  it('renders hard line breaks for two trailing spaces', () => {
    expect(renderMarkdownToSafeHtml('line1  \nline2')).toContain('<br />');
  });
});

describe('renderMarkdownToSafeHtml — lists', () => {
  it('renders an unordered list', () => {
    const html = renderMarkdownToSafeHtml('- one\n- two\n- three');
    expect(html).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>');
  });
  it('renders an ordered list and preserves start number', () => {
    const html = renderMarkdownToSafeHtml('3. third\n4. fourth');
    expect(html).toBe('<ol start="3"><li>third</li><li>fourth</li></ol>');
  });
  it('renders nested unordered list', () => {
    const html = renderMarkdownToSafeHtml('- top\n  - child\n  - sibling\n- next');
    expect(html).toBe(
      '<ul><li>top<ul><li>child</li><li>sibling</li></ul></li><li>next</li></ul>',
    );
  });
  it('renders inline emphasis inside list items', () => {
    const html = renderMarkdownToSafeHtml('- **bold**\n- *italic*');
    expect(html).toBe('<ul><li><strong>bold</strong></li><li><em>italic</em></li></ul>');
  });
});

describe('renderMarkdownToSafeHtml — blockquotes / hr / code fences', () => {
  it('renders blockquote with nested paragraph', () => {
    expect(renderMarkdownToSafeHtml('> quoted text')).toBe(
      '<blockquote><p>quoted text</p></blockquote>',
    );
  });
  it('renders thematic break', () => {
    expect(renderMarkdownToSafeHtml('---')).toBe('<hr />');
  });
  it('renders fenced code block and preserves indentation', () => {
    const src = '```ts\nconst x = 1;\n  const y = 2;\n```';
    expect(renderMarkdownToSafeHtml(src)).toBe(
      '<pre><code class="language-ts">const x = 1;\n  const y = 2;</code></pre>',
    );
  });
  it('escapes html inside fenced code', () => {
    const src = '```\n<script>alert(1)</script>\n```';
    expect(renderMarkdownToSafeHtml(src)).toContain('&lt;script&gt;');
    expect(renderMarkdownToSafeHtml(src)).not.toContain('<script>');
  });
});

describe('renderMarkdownToSafeHtml — links', () => {
  it('renders an https link with safe attributes', () => {
    expect(renderMarkdownToSafeHtml('[docs](https://slidestage.dev)')).toBe(
      '<p><a href="https://slidestage.dev" target="_blank" rel="noopener noreferrer">docs</a></p>',
    );
  });
  it('renders a mailto link', () => {
    const html = renderMarkdownToSafeHtml('[mail](mailto:test@example.com)');
    expect(html).toContain('href="mailto:test@example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('renders an anchor link', () => {
    expect(renderMarkdownToSafeHtml('[top](#section)')).toContain('href="#section"');
  });
  it('renders relative path links', () => {
    expect(renderMarkdownToSafeHtml('[next](./slide-02.html)')).toContain(
      'href="./slide-02.html"',
    );
  });
  it('renders bold text inside link', () => {
    expect(renderMarkdownToSafeHtml('[**bold**](https://x.y)')).toBe(
      '<p><a href="https://x.y" target="_blank" rel="noopener noreferrer"><strong>bold</strong></a></p>',
    );
  });
});

describe('renderMarkdownToSafeHtml — security (XSS hardening)', () => {
  it('escapes raw script tags', () => {
    const html = renderMarkdownToSafeHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes raw img tags with onerror', () => {
    const html = renderMarkdownToSafeHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('rejects javascript: link href (no <a> emitted, dangerous URL never wired as href)', () => {
    const html = renderMarkdownToSafeHtml('[click](javascript:alert(1))');
    // The URL allowlist refuses the dangerous protocol, so the renderer
    // falls back to leaving the input as literal text. What matters for
    // security is that no `<a href="javascript:…">` makes it into the
    // DOM — the literal text "javascript:" is harmless because it is
    // never interpreted as an attribute.
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href=\'javascript:');
    expect(html).not.toContain('<a ');
  });

  it('rejects data: link href', () => {
    const html = renderMarkdownToSafeHtml('[x](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('<a ');
    // The inline `<script>` should be html-escaped, not left as a live tag.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects vbscript: link href', () => {
    const html = renderMarkdownToSafeHtml('[x](vbscript:msgbox(1))');
    expect(html).not.toContain('href="vbscript:');
    expect(html).not.toContain('<a ');
  });

  it('strips on-attribute injection attempts inside link text', () => {
    // The text segment runs through escapeHtml, so even tag-like
    // sequences become harmless entities.
    const html = renderMarkdownToSafeHtml(
      '[<img src=x onerror=alert(1)>](https://x.y)',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('href="https://x.y"');
  });

  it('escapes < and > characters anywhere', () => {
    const html = renderMarkdownToSafeHtml('a < b > c');
    expect(html).toBe('<p>a &lt; b &gt; c</p>');
  });

  it('isSafeUrl rejects unknown protocols', () => {
    expect(__internal.isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(__internal.isSafeUrl('JAVASCRIPT:alert(1)')).toBe(false);
    expect(__internal.isSafeUrl('vbscript:x')).toBe(false);
    expect(__internal.isSafeUrl('data:text/html,x')).toBe(false);
    expect(__internal.isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('isSafeUrl accepts allowlisted protocols', () => {
    expect(__internal.isSafeUrl('https://slidestage.dev')).toBe(true);
    expect(__internal.isSafeUrl('http://example.com')).toBe(true);
    expect(__internal.isSafeUrl('mailto:a@b.c')).toBe(true);
    expect(__internal.isSafeUrl('tel:+1234567890')).toBe(true);
    expect(__internal.isSafeUrl('#anchor')).toBe(true);
    expect(__internal.isSafeUrl('/abs/path')).toBe(true);
    expect(__internal.isSafeUrl('./rel/path')).toBe(true);
    expect(__internal.isSafeUrl('relative.html')).toBe(true);
  });

  it('sanitizer is idempotent on already-safe markdown', () => {
    const src = '# title\n\n- one\n- two\n\n**hi**';
    const once = renderMarkdownToSafeHtml(src);
    const twice = __internal.sanitizeHtml(once);
    expect(twice).toBe(once);
  });
});

describe('renderMarkdownToSafeHtml — GFM tables', () => {
  it('renders a minimal 2-column table', () => {
    const src = '| h1 | h2 |\n| --- | --- |\n| a | b |';
    const html = renderMarkdownToSafeHtml(src);
    expect(html).toBe(
      '<table><thead><tr><th>h1</th><th>h2</th></tr></thead>' +
        '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
  });

  it('renders a header-only table with no body rows', () => {
    const src = '| h1 | h2 |\n| --- | --- |';
    const html = renderMarkdownToSafeHtml(src);
    expect(html).toBe(
      '<table><thead><tr><th>h1</th><th>h2</th></tr></thead></table>',
    );
  });

  it('accepts the outer-pipeless GFM form', () => {
    const src = 'h1 | h2\n--- | ---\na | b';
    const html = renderMarkdownToSafeHtml(src);
    expect(html).toContain('<th>h1</th><th>h2</th>');
    expect(html).toContain('<td>a</td><td>b</td>');
  });

  it('honors :---: / ---: / :--- alignment markers', () => {
    const src =
      '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |';
    const html = renderMarkdownToSafeHtml(src);
    // Header alignment carries onto <th>.
    expect(html).toContain('<th style="text-align:left">L</th>');
    expect(html).toContain('<th style="text-align:center">C</th>');
    expect(html).toContain('<th style="text-align:right">R</th>');
    // Same alignment carries to body <td>.
    expect(html).toContain('<td style="text-align:left">a</td>');
    expect(html).toContain('<td style="text-align:center">b</td>');
    expect(html).toContain('<td style="text-align:right">c</td>');
  });

  it('pads short rows and truncates long rows to header arity', () => {
    const src = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |\n| 4 | 5 | 6 | 7 |';
    const html = renderMarkdownToSafeHtml(src);
    // Short row gets an empty trailing cell.
    expect(html).toContain('<tr><td>1</td><td>2</td><td></td></tr>');
    // Long row gets truncated to 3 cells.
    expect(html).toContain('<tr><td>4</td><td>5</td><td>6</td></tr>');
    expect(html).not.toContain('<td>7</td>');
  });

  it('renders inline emphasis inside table cells', () => {
    const src = '| h |\n| --- |\n| **bold** *em* `code` |';
    const html = renderMarkdownToSafeHtml(src);
    expect(html).toContain(
      '<td><strong>bold</strong> <em>em</em> <code>code</code></td>',
    );
  });

  it('escapes html inside cells', () => {
    const src = '| h |\n| --- |\n| <script>alert(1)</script> |';
    const html = renderMarkdownToSafeHtml(src);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls through to paragraph when the separator row is missing', () => {
    // `| a | b |` alone — no `| --- |` — is just prose with pipes.
    const src = '| a | b |';
    expect(renderMarkdownToSafeHtml(src)).toBe('<p>| a | b |</p>');
  });

  it('terminates a preceding paragraph that runs into a table opener', () => {
    const src = 'sentence one.\n| h |\n| --- |\n| body |';
    const html = renderMarkdownToSafeHtml(src);
    expect(html).toContain('<p>sentence one.</p>');
    expect(html).toContain('<th>h</th>');
    expect(html).toContain('<td>body</td>');
  });

  it('does not confuse a thematic break with a table separator', () => {
    // The `---` line has no `|`; isTableSeparator() must reject it.
    expect(__internal.isTableSeparator('---')).toBe(false);
    expect(__internal.isTableSeparator('| --- |')).toBe(true);
    expect(__internal.isTableSeparator('| :---: |')).toBe(true);
    // A pipe-only line with no dashes must NOT count.
    expect(__internal.isTableSeparator('| | |')).toBe(false);
  });

  it('survives sanitizer pass (table tags are not stripped)', () => {
    const src = '| h1 |\n| --- |\n| x |';
    const html = renderMarkdownToSafeHtml(src);
    // The sanitizeHtml pass must NOT remove table-family tags.
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
  });
});

describe('renderMarkdownToSafeHtml — kitchen sink', () => {
  it('renders a realistic speaker-notes block end-to-end', () => {
    const notes = [
      '# Opening',
      '',
      'Talk about the **product**. Hit these beats:',
      '',
      '- Demo the *laser pointer*',
      '- Switch to `presenter` mode',
      '- Show the [docs](https://slidestage.dev/docs)',
      '',
      '> Remember to pause for questions.',
      '',
      '```bash',
      'pnpm dev',
      '```',
      '',
      '---',
      '',
      'See you on stage!',
    ].join('\n');
    const html = renderMarkdownToSafeHtml(notes);
    expect(html).toContain('<h1>Opening</h1>');
    expect(html).toContain('<strong>product</strong>');
    expect(html).toContain('<em>laser pointer</em>');
    expect(html).toContain('<code>presenter</code>');
    expect(html).toContain('href="https://slidestage.dev/docs"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre><code class="language-bash">pnpm dev</code></pre>');
    expect(html).toContain('<hr />');
  });
});
