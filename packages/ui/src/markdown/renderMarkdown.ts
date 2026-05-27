/**
 * Zero-dependency Markdown renderer.
 *
 * Originally written for speaker notes (short prose). Now also used by
 * surfaces that render mirrored markdown docs — `rootwebsite/docs/*`,
 * the changelog page, and other longer-form pages. GFM table support
 * (added in `@slidestage/ui@0.1.2`) makes the renderer usable for those
 * docs without pulling in a full markdown library; `sync-docs.mjs`
 * mirrors GFM tables into the curated set and they need to render the
 * same way Lite and the marketing site read them.
 *
 * Why zero deps?
 *   `@slidestage/ui` is consumed by SlideStage Lite, which positions itself
 *   as a pure-frontend, zero-dependency runtime (see
 *   `.cursor/rules/project-boundaries.mdc`). Pulling in `marked`,
 *   `markdown-it`, or `remark` would add 30-60 KB gzipped before any
 *   sanitization. A focused GFM subset covers every realistic note we
 *   have seen in fixtures, real decks, and curated docs.
 *
 * Supported syntax (intentionally small but covers ~95% of speaker-note
 * AND ~100% of mirrored-doc use cases):
 *   - ATX headings           `# … ######`
 *   - Paragraphs separated by blank lines
 *   - Unordered lists        `- item` / `* item` / `+ item`, with one
 *                            level of nesting via leading spaces (2+).
 *   - Ordered lists          `1. item` (start number preserved)
 *   - Blockquotes            `> quoted` (recursively renders block content)
 *   - Fenced code blocks     ``` ```lang … ``` ```
 *   - Thematic breaks        `---`, `***`, `___` on their own line
 *   - GFM tables             `| col | col |` + `| --- | --- |` row,
 *                            with optional `:---:` alignment.
 *   - Inline code            `` `code` ``
 *   - Bold                   `**bold**`
 *   - Italic                 `*italic*`
 *   - Strikethrough          `~~strike~~`
 *   - Links                  `[text](href)` (only http(s), mailto, tel,
 *                            anchors, and root-relative paths are kept;
 *                            everything else is rendered as literal text)
 *   - Hard line break        trailing two spaces before a newline
 *
 * Deliberately NOT supported:
 *   - Task lists, footnotes, definition lists, reference-style links.
 *   - Images. Mirrored docs currently contain none; adding image
 *     support would require a separate src allowlist + style budget.
 *   - Raw HTML — any `<` / `>` in the source is escaped, so callers
 *     cannot inject script tags, iframes, or event handlers.
 *
 * Security model:
 *   1. All user content goes through `escapeHtml` BEFORE any markdown
 *      structure is reified, so raw HTML can never reach the DOM.
 *   2. Markdown structures we emit (heading, list, link, etc.) are a
 *      finite, hardcoded set. We never reflect attribute names from
 *      user input.
 *   3. Link `href` values are validated against an allowlist of
 *      protocols; rejected links fall back to literal text.
 *   4. A trailing `sanitizeHtml` pass acts as defense-in-depth: even if
 *      a regex above had a bug, the sanitizer strips known-dangerous
 *      tags and attributes before the string ever reaches React.
 */

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Permissive URL allowlist. We accept the protocols that show up in real
 * speaker notes (links to docs, mail handoffs, anchors inside the deck)
 * and reject everything else — most importantly `javascript:`, `data:`,
 * and `vbscript:` which are classic XSS vectors via `<a href>`.
 */
function isSafeUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  const lower = url.toLowerCase();

  // Hard-block dangerous protocols first.
  if (lower.startsWith('javascript:')) return false;
  if (lower.startsWith('data:')) return false;
  if (lower.startsWith('vbscript:')) return false;
  if (lower.startsWith('file:')) return false;
  if (lower.startsWith('blob:')) return false;

  // Explicitly allowed protocols.
  if (/^https?:\/\//.test(lower)) return true;
  if (lower.startsWith('mailto:')) return true;
  if (lower.startsWith('tel:')) return true;

  // Anchors and same-origin relative URLs are fine.
  if (url.startsWith('#')) return true;
  if (url.startsWith('/')) return true;
  if (url.startsWith('./') || url.startsWith('../')) return true;

  // Anything that smells like an unknown protocol (has `:` before any `/`)
  // is rejected so we never accidentally allow a new dangerous scheme.
  if (/^[a-z][a-z0-9+\-.]*:/i.test(url)) return false;

  // Plain relative paths like `page.html` survive.
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Inline pass                                                               */
/* -------------------------------------------------------------------------- */

// NUL placeholder used to stash already-rendered atomic fragments (code
// spans, links) so they survive the HTML-escape + emphasis passes
// without being mangled.
const SENTINEL = '\u0000';

interface InlineState {
  stash: string[];
}

function pushStashed(state: InlineState, html: string): string {
  const idx = state.stash.length;
  state.stash.push(html);
  return `${SENTINEL}${idx}${SENTINEL}`;
}

function restoreStashed(input: string, state: InlineState): string {
  return input.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_, n) => {
    const html = state.stash[Number(n)];
    return html ?? '';
  });
}

/**
 * Inline-level renderer. Operates in three phases on the raw source:
 *
 *   1. Pull out atomic fragments (inline code, links) and replace them
 *      with NUL-delimited stash markers.
 *   2. Escape any remaining raw HTML so `<script>` / `<img onerror>` /
 *      etc. cannot survive the pipeline.
 *   3. Apply emphasis/strikethrough regexes on the safe string, then
 *      restore the stashed fragments verbatim.
 */
function renderInline(rawSource: string): string {
  const state: InlineState = { stash: [] };
  let working = rawSource;

  // (1a) Inline code spans. These take precedence so backticks inside
  // emphasized text don't get split.
  working = working.replace(/`+([^`\n]+?)`+/g, (_, code) => {
    return pushStashed(state, `<code>${escapeHtml(code)}</code>`);
  });

  // (1b) Inline links `[text](href "title")`. `title` is optional and
  // currently dropped to keep the output minimal.
  working = working.replace(
    /\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
    (match, text: string, href: string) => {
      if (!isSafeUrl(href)) return match; // fall back to literal text
      const safeHref = escapeHtml(href.trim());
      // Recursively render the visible text — emphasis inside link text
      // is common (e.g. `[**docs**](…)`).
      const renderedText = renderInline(text);
      return pushStashed(
        state,
        `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${renderedText}</a>`,
      );
    },
  );

  // (2) Escape any remaining HTML-special characters. After this step the
  // string is safe to splice into the DOM via dangerouslySetInnerHTML;
  // every subsequent regex only invents <strong> / <em> / <del> / <br>.
  working = escapeHtml(working);

  // (3a) Bold `**x**`. We match non-greedy so `**a** **b**` becomes two
  // distinct <strong> spans.
  working = working.replace(/\*\*([^*\n][^\n]*?[^*\n]|[^*\n])\*\*/g, '<strong>$1</strong>');

  // (3b) Strikethrough `~~x~~`.
  working = working.replace(/~~([^~\n][^\n]*?[^~\n]|[^~\n])~~/g, '<del>$1</del>');

  // (3c) Italic `*x*`. We require non-whitespace on both inner edges so
  // multiplication-style text (`5 * 3 = 15`) is not eaten.
  working = working.replace(/(^|[^*\w])\*([^*\s][^*\n]*?[^*\s])\*(?!\*)/g, '$1<em>$2</em>');
  working = working.replace(/(^|[^*\w])\*([^*\s])\*(?!\*)/g, '$1<em>$2</em>');

  // (4) Hard line break: two trailing spaces before a newline.
  working = working.replace(/ {2,}\n/g, '<br />\n');

  // (5) Restore stashed fragments.
  return restoreStashed(working, state);
}

/* -------------------------------------------------------------------------- */
/*  Block pass                                                                */
/* -------------------------------------------------------------------------- */

interface ListItem {
  readonly ordered: boolean;
  readonly indent: number;
  readonly start: number; // ordered list start number (1-based)
  content: string[]; // raw text lines belonging to this item
}

function isListStart(line: string): boolean {
  return /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/.test(line);
}

function parseListItem(line: string):
  | { ordered: boolean; indent: number; start: number; rest: string }
  | null {
  const m = /^(\s{0,3})([-*+]|(\d{1,9})[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  return {
    ordered: m[3] !== undefined,
    indent: m[1].length,
    start: m[3] !== undefined ? Number(m[3]) : 1,
    rest: m[4],
  };
}

function collectList(lines: string[], from: number): { items: ListItem[]; next: number } {
  const items: ListItem[] = [];
  let i = from;
  const first = parseListItem(lines[i]);
  if (!first) return { items, next: i };
  const baseIndent = first.indent;
  items.push({ ordered: first.ordered, indent: baseIndent, start: first.start, content: [first.rest] });
  i++;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line: peek next — if it's a continuation list item, keep
    // going (loose list). Otherwise terminate.
    if (line.trim() === '') {
      const next = lines[i + 1];
      if (next && isListStart(next)) {
        items[items.length - 1].content.push('');
        i++;
        continue;
      }
      break;
    }

    const parsed = parseListItem(line);
    if (parsed) {
      if (parsed.ordered !== items[0].ordered && parsed.indent === baseIndent) {
        // Switching list type at the same indent ends this block.
        break;
      }
      items.push({
        ordered: parsed.ordered,
        indent: parsed.indent,
        start: parsed.start,
        content: [parsed.rest],
      });
      i++;
      continue;
    }

    // Continuation line: indented at least two spaces past the bullet.
    const wsMatch = /^( +)(.*)$/.exec(line);
    if (wsMatch && wsMatch[1].length >= baseIndent + 2) {
      const last = items[items.length - 1];
      last.content.push(wsMatch[2]);
      i++;
      continue;
    }

    break;
  }

  return { items, next: i };
}

function renderListItems(items: ListItem[]): string {
  if (items.length === 0) return '';
  const ordered = items[0].ordered;
  const baseIndent = items[0].indent;
  const tag = ordered ? 'ol' : 'ul';
  const startAttr =
    ordered && items[0].start !== 1 ? ` start="${escapeHtml(String(items[0].start))}"` : '';

  const out: string[] = [`<${tag}${startAttr}>`];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.indent !== baseIndent) {
      i++;
      continue;
    }
    // Collect any deeper items as the nested children of this <li>.
    const children: ListItem[] = [];
    let j = i + 1;
    while (j < items.length && items[j].indent > baseIndent) {
      children.push(items[j]);
      j++;
    }
    const text = item.content.join('\n').trim();
    let inner = renderInline(text);
    if (children.length > 0) {
      inner += renderListItems(children);
    }
    out.push(`<li>${inner}</li>`);
    i = j;
  }
  out.push(`</${tag}>`);
  return out.join('');
}

/* -------------------------------------------------------------------------- */
/*  GFM tables                                                                */
/* -------------------------------------------------------------------------- */

type CellAlign = 'left' | 'center' | 'right' | null;

/**
 * Split a single table row into its trimmed cells. Accepts both
 * fully-bordered (`| a | b |`) and outer-pipeless (`a | b`) forms,
 * which both appear in real GFM-flavored docs.
 *
 * Escaped pipes (`\|`) inside cell content are rare in our docs and
 * are intentionally NOT supported — keeping the splitter a single
 * `.split('|')` keeps the parser small and predictable. If we ever
 * see an upstream doc that needs escaped pipes, swap in a hand-rolled
 * scanner.
 */
function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((c) => c.trim());
}

/**
 * Recognize a GFM table separator row, e.g. `| --- | :---: | ---: |`.
 * Requires at least one `-`, only pipe/colon/dash/whitespace
 * characters, and a `|` so we never confuse it with a thematic break.
 */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|')) return false;
  if (!line.includes('-')) return false;
  return /^[\s|:-]+$/.test(line);
}

function parseTableAlignments(separator: string): CellAlign[] {
  return splitTableRow(separator).map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/**
 * Attempt to render a GFM table starting at `lines[startIdx]`.
 *
 * Returns `null` if the lookahead doesn't form a valid header +
 * separator pair; the caller then falls through to its paragraph
 * branch. Returns `{ html, next }` on success, where `next` is the
 * index of the first line AFTER the table.
 */
function tryRenderTable(
  lines: readonly string[],
  startIdx: number,
): { html: string; next: number } | null {
  const headerLine = lines[startIdx];
  const separator = lines[startIdx + 1];
  if (!isTableSeparator(separator)) return null;
  const headerCells = splitTableRow(headerLine);
  if (headerCells.length === 0) return null;
  const align = parseTableAlignments(separator);
  if (align.length !== headerCells.length) return null;

  const bodyRows: string[][] = [];
  let i = startIdx + 2;
  while (i < lines.length) {
    const row = lines[i];
    if (row.trim() === '') break;
    if (!row.includes('|')) break;
    const cells = splitTableRow(row);
    if (cells.length === 0) break;
    // Pad short rows / truncate long rows so we always emit a square
    // table matching the header arity. Mirrors GFM rendering in
    // GitHub itself.
    while (cells.length < headerCells.length) cells.push('');
    if (cells.length > headerCells.length) cells.length = headerCells.length;
    bodyRows.push(cells);
    i++;
  }

  const styleAttr = (a: CellAlign) =>
    a ? ` style="text-align:${a}"` : '';

  const headerHtml = headerCells
    .map((cell, idx) => `<th${styleAttr(align[idx])}>${renderInline(cell)}</th>`)
    .join('');
  const bodyHtml = bodyRows
    .map(
      (row) =>
        '<tr>' +
        row
          .map(
            (cell, idx) =>
              `<td${styleAttr(align[idx])}>${renderInline(cell)}</td>`,
          )
          .join('') +
        '</tr>',
    )
    .join('');

  const html =
    `<table><thead><tr>${headerHtml}</tr></thead>` +
    (bodyRows.length > 0 ? `<tbody>${bodyHtml}</tbody>` : '') +
    `</table>`;

  return { html, next: i };
}

function renderBlocks(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines between blocks.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block. We accept ``` and ~~~ openers; the closing
    // fence must match the opening fence character.
    const fenceOpen = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`~]*)\s*$/.exec(line);
    if (fenceOpen) {
      const fenceChar = fenceOpen[2][0];
      const fenceLen = fenceOpen[2].length;
      const lang = fenceOpen[3];
      const code: string[] = [];
      i++;
      const closeRe = new RegExp(`^\\s{0,3}${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`);
      while (i < lines.length && !closeRe.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // eat the closing fence
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${langClass}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // ATX heading. We strip optional trailing closing `#` characters.
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Thematic break.
    if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // Blockquote. We strip the leading `>` and recursively render the
    // remainder so nested quotes / lists work.
    if (/^\s{0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    // List.
    if (isListStart(line)) {
      const { items, next } = collectList(lines, i);
      out.push(renderListItems(items));
      i = next;
      continue;
    }

    // GFM table.
    //
    // We probe `tryRenderTable` cheaply (a `|` plus a separator line
    // follow-up) before committing to the table branch — if the
    // header+separator pattern doesn't validate, we fall through to
    // the paragraph branch so a plain sentence containing `|` still
    // renders as prose.
    if (line.includes('|') && i + 1 < lines.length) {
      const tableHtml = tryRenderTable(lines, i);
      if (tableHtml !== null) {
        out.push(tableHtml.html);
        i = tableHtml.next;
        continue;
      }
    }

    // Paragraph: greedy through to blank line or next block-level
    // construct.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const peek = lines[i];
      if (peek.trim() === '') break;
      if (
        isListStart(peek) ||
        /^(#{1,6})\s+/.test(peek) ||
        /^\s{0,3}>/.test(peek) ||
        /^\s{0,3}(`{3,}|~{3,})/.test(peek) ||
        /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/.test(peek)
      ) {
        break;
      }
      // GFM table opener mid-paragraph terminates the paragraph too.
      // Without this guard, a `Param | Description` table heading
      // immediately after a sentence gets absorbed into the paragraph
      // and never sees the table parser.
      if (
        peek.includes('|') &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) {
        break;
      }
      para.push(peek);
      i++;
    }
    // Join paragraph lines with newline so hard-break detection (two
    // trailing spaces) inside renderInline still works.
    out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }

  return out.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Defensive sanitizer (belt + suspenders)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Final safety pass over the rendered HTML. The renderer above already
 * controls every tag and attribute it emits, so in theory this is a
 * no-op for well-formed input. It exists to catch regressions: if a
 * future change accidentally leaks a `<script>` or an `onclick=`, this
 * pass strips it before React inserts the string into the DOM.
 */
function sanitizeHtml(html: string): string {
  let safe = html;
  // Strip script / style / iframe / object / embed / link / meta / form
  // tags and their contents — none of them can be produced by the
  // renderer above but we drop them defensively.
  //
  // Note: `<table> / <thead> / <tbody> / <tr> / <th> / <td>` are NOT
  // in the blocklist. They are emitted by the GFM table parser and
  // pass through verbatim. The only attribute we emit on them is
  // `style="text-align:..."`, which is whitelisted-by-omission below
  // (the `on*` handler stripper + dangerous-href stripper only
  // target the actual XSS sinks).
  safe = safe.replace(
    /<(script|style|iframe|object|embed|form|link|meta|svg|math)\b[\s\S]*?<\/\1>/gi,
    '',
  );
  safe = safe.replace(
    /<(script|style|iframe|object|embed|form|link|meta|svg|math)\b[^>]*\/?>/gi,
    '',
  );
  // Drop inline event handlers (`onclick=…`, `onerror=…`, …).
  safe = safe.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  safe = safe.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  safe = safe.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // Drop `javascript:` / `vbscript:` / `data:` href values that somehow
  // made it through the URL allowlist.
  safe = safe.replace(/\shref\s*=\s*"(?:\s*)(?:javascript|vbscript|data):[^"]*"/gi, ' href="#"');
  safe = safe.replace(/\shref\s*=\s*'(?:\s*)(?:javascript|vbscript|data):[^']*'/gi, " href='#'");
  return safe;
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Convert markdown source into sanitized HTML suitable for
 * `dangerouslySetInnerHTML`. Returns an empty string for empty input.
 *
 * Callers can treat the return value as trusted HTML — every code path
 * either escapes user content or emits hard-coded tags from a finite
 * allowlist, with a final defensive sanitizer pass.
 */
export function renderMarkdownToSafeHtml(source: string | null | undefined): string {
  if (source === null || source === undefined) return '';
  const trimmed = source.trim();
  if (trimmed === '') return '';
  return sanitizeHtml(renderBlocks(source));
}

// Internals exported for testing only.
export const __internal = {
  escapeHtml,
  isSafeUrl,
  renderInline,
  renderBlocks,
  sanitizeHtml,
  tryRenderTable,
  isTableSeparator,
};
