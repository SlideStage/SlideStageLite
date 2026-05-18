// Lightweight, regex-driven HTML block walker shared by every splitter
// (inline-deck `<section class="slide">`, webcomponent-deck `<deck-slide>`,
// etc). Avoids a DOM dependency so the converter runs in both Node and the
// browser. Sections are matched by tag name and an attribute predicate; the
// walker handles arbitrary nested occurrences of the same tag.

export interface ExtractedBlock {
  /** Raw attribute string from the opening tag (without the leading space). */
  attributes: string;
  /** HTML between the opening and closing tag, verbatim. */
  innerHtml: string;
}

export interface ExtractOptions {
  tagName: string;
  /**
   * Optional filter on the attributes captured from the opening tag. Return
   * true to include the block, false to skip it (but still advance past it).
   */
  isMatch?: (attributes: string) => boolean;
}

/**
 * Returns all top-level blocks of `<tagName>` in `html`, with arbitrary
 * nested occurrences of the same tag tracked via a depth counter. Skipped
 * blocks (where `isMatch` returns false) are advanced past but not included.
 */
export function extractBalancedBlocks(html: string, opts: ExtractOptions): ExtractedBlock[] {
  const out: ExtractedBlock[] = [];
  const openRe = new RegExp(`<${opts.tagName}\\b([^>]*)>`, 'gi');
  const closeRe = new RegExp(`</${opts.tagName}\\s*>`, 'gi');

  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(html)) !== null) {
    const attrs = openMatch[1];
    const innerStart = openRe.lastIndex;
    const include = opts.isMatch ? opts.isMatch(attrs) : true;

    const closeIndex = findMatchingClose(html, innerStart, openRe, closeRe);
    if (closeIndex === -1) break;

    if (include) {
      out.push({
        attributes: attrs,
        innerHtml: html.substring(innerStart, closeIndex),
      });
    }

    openRe.lastIndex = closeIndex + `</${opts.tagName}>`.length;
  }

  return out;
}

function findMatchingClose(
  html: string,
  startIndex: number,
  openRe: RegExp,
  closeRe: RegExp,
): number {
  openRe.lastIndex = startIndex;
  closeRe.lastIndex = startIndex;

  let depth = 1;
  let openMatch = openRe.exec(html);
  let closeMatch = closeRe.exec(html);

  while (closeMatch) {
    const closeAt = closeMatch.index;
    while (openMatch && openMatch.index < closeAt) {
      depth += 1;
      openMatch = openRe.exec(html);
    }

    depth -= 1;
    if (depth === 0) {
      return closeAt;
    }

    closeMatch = closeRe.exec(html);
  }

  return -1;
}
