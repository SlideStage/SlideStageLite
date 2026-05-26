const textDecoder = new TextDecoder('utf-8', { fatal: false });

export type SniffKind =
  | 'slidestage@1.0'
  | 'inline-deck'
  | 'webcomponent-deck'
  | 'router-html'
  | 'reveal'
  | 'impress'
  | 'plain-html'
  | 'ambiguous'
  | 'empty';

export interface RouterManifestEntry {
  file: string;
  label?: string;
}

export interface SniffResult {
  kind: SniffKind;
  confidence: number;
  rootHtml?: string;
  hints?: {
    candidateRoots?: string[];
    routerManifest?: RouterManifestEntry[];
    inlineSectionCount?: number;
    inlineSectionLabels?: string[];
  };
}

function listHtmlEntries(entries: Map<string, Uint8Array>): string[] {
  return Array.from(entries.keys())
    .filter((path) => /\.html?$/i.test(path))
    .sort();
}

function pickRootHtml(htmlEntries: string[]): string | null {
  if (htmlEntries.length === 0) {
    return null;
  }

  const indexCandidates = htmlEntries.filter((path) => /^index\.html?$/i.test(path));
  if (indexCandidates.length > 0) {
    return indexCandidates[0];
  }

  const rootLevel = htmlEntries.filter((path) => !path.includes('/'));
  if (rootLevel.length === 1) {
    return rootLevel[0];
  }

  // Multiple top-level HTML files without an index — caller treats this as ambiguous.
  return null;
}

function decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function detectWebComponent(html: string): boolean {
  return /<deck-stage\b/i.test(html);
}

function collectScriptSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push((m[2] ?? m[3] ?? m[4] ?? '') as string);
  }
  return out;
}

function detectReveal(html: string, scripts: string[]): boolean {
  // reveal.js root: <div class="reveal"><div class="slides">… both classes
  // present at top-level signal the framework. Either marker on its own is
  // insufficient because lots of unrelated pages also use a "reveal" class.
  const hasRevealRoot =
    /<div\b[^>]*\bclass\s*=\s*("[^"]*\breveal\b[^"]*"|'[^']*\breveal\b[^']*')/i.test(html) &&
    /<div\b[^>]*\bclass\s*=\s*("[^"]*\bslides\b[^"]*"|'[^']*\bslides\b[^']*')/i.test(html);
  const hasRevealScript = scripts.some((s) => /reveal(\.min)?\.js(?:[?#].*)?$/i.test(s));
  return hasRevealRoot || hasRevealScript;
}

function detectImpress(html: string, scripts: string[]): boolean {
  const hasImpressRoot = /<div\b[^>]*\bid\s*=\s*("impress"|'impress')/i.test(html);
  const hasImpressScript = scripts.some((s) => /impress(\.min)?\.js(?:[?#].*)?$/i.test(s));
  return hasImpressRoot || hasImpressScript;
}

function detectWebComponentSlides(html: string): { count: number; labels: string[] } {
  const tagRegex = /<deck-slide\b([^>]*)>/gi;
  const labels: string[] = [];
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = tagRegex.exec(html)) !== null) {
    count += 1;
    const label = extractDataTitle(match[0]);
    if (label) labels.push(label);
  }
  return { count, labels };
}

function detectInlineDeck(html: string): { matches: boolean; sectionCount: number; labels: string[] } {
  const sectionRegex = /<section\b[^>]*\bclass=["'][^"']*\bslide\b[^"']*["'][^>]*>/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(html)) !== null) {
    matches.push(match[0]);
  }

  const hasDeckWrapper = /<(?:div|section|main)\b[^>]*\bclass=["'][^"']*\bdeck\b[^"']*["']/i.test(html);
  const referencesRuntime = /\bruntime\.js\b/i.test(html);

  const sectionCount = matches.length;
  const labels = matches.map((tag) => extractDataTitle(tag)).filter((value): value is string => Boolean(value));

  // Need either explicit .deck wrapper or a runtime.js reference + at least one .slide section to be confident.
  const matchesShape = (hasDeckWrapper || referencesRuntime) && sectionCount > 0;
  return { matches: matchesShape, sectionCount, labels };
}

function extractDataTitle(tag: string): string | null {
  const match = /\bdata-title=("([^"]*)"|'([^']*)')/i.exec(tag);
  if (!match) {
    return null;
  }
  return (match[2] ?? match[3] ?? '').trim() || null;
}

function detectRouterManifest(html: string): RouterManifestEntry[] | null {
  const startMatch = /window\.DECK_MANIFEST\s*=\s*\[/.exec(html);
  if (!startMatch) {
    return null;
  }

  const start = startMatch.index + startMatch[0].length - 1; // index of '['
  let depth = 0;
  let end = -1;
  let inString: '"' | "'" | null = null;
  let escape = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    return null;
  }

  const raw = html.substring(start, end + 1);
  const parsed = tryParseJsArray(raw);
  if (!parsed) {
    return null;
  }

  const out: RouterManifestEntry[] = [];
  for (const item of parsed) {
    if (item && typeof item === 'object' && typeof (item as { file?: unknown }).file === 'string') {
      const file = (item as { file: string }).file.trim();
      if (!file) continue;
      const labelValue = (item as { label?: unknown }).label;
      const label = typeof labelValue === 'string' ? labelValue : undefined;
      out.push(label ? { file, label } : { file });
    }
  }

  return out.length > 0 ? out : null;
}

function tryParseJsArray(raw: string): unknown[] | null {
  try {
    return JSON.parse(raw) as unknown[];
  } catch {
    // Continue to a JS-literal normalization pass.
  }

  const normalized = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/(\{|,)\s*([a-zA-Z_$][\w$]*)\s*:/g, '$1 "$2":')
    .replace(/'/g, '"')
    .replace(/,(\s*[\]}])/g, '$1');

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function sniffDeck(entries: Map<string, Uint8Array>): SniffResult {
  if (entries.has('manifest.json')) {
    return { kind: 'slidestage@1.0', confidence: 1.0 };
  }

  const htmlEntries = listHtmlEntries(entries);
  if (htmlEntries.length === 0) {
    return { kind: 'empty', confidence: 1.0 };
  }

  const rootHtml = pickRootHtml(htmlEntries);
  if (!rootHtml) {
    return {
      kind: 'ambiguous',
      confidence: 0.5,
      hints: { candidateRoots: htmlEntries.filter((path) => !path.includes('/')) },
    };
  }

  const rootBytes = entries.get(rootHtml);
  if (!rootBytes) {
    return { kind: 'empty', confidence: 1.0 };
  }

  const html = decode(rootBytes);
  const scripts = collectScriptSrcs(html);

  if (detectWebComponent(html)) {
    const wc = detectWebComponentSlides(html);
    const inline = detectInlineDeck(html);
    return {
      kind: 'webcomponent-deck',
      confidence: 0.9,
      rootHtml,
      hints: {
        candidateRoots: [rootHtml],
        inlineSectionCount: wc.count > 0 ? wc.count : inline.sectionCount,
        inlineSectionLabels: wc.labels.length > 0 ? wc.labels : inline.labels,
      },
    };
  }

  const routerManifest = detectRouterManifest(html);
  if (routerManifest) {
    const missing = routerManifest.filter((entry) => !entries.has(normalizeRelativePath(rootHtml, entry.file)));
    return {
      kind: 'router-html',
      confidence: missing.length === 0 ? 0.95 : 0.6,
      rootHtml,
      hints: { candidateRoots: [rootHtml], routerManifest },
    };
  }

  // reveal/impress are detected before inline-deck because their <section>
  // markup can satisfy the inline-deck shape (.deck wrapper + runtime.js),
  // but their authoring conventions deserve framework-aware splitting.
  if (detectReveal(html, scripts)) {
    return {
      kind: 'reveal',
      confidence: 0.9,
      rootHtml,
      hints: { candidateRoots: [rootHtml] },
    };
  }

  if (detectImpress(html, scripts)) {
    return {
      kind: 'impress',
      confidence: 0.9,
      rootHtml,
      hints: { candidateRoots: [rootHtml] },
    };
  }

  const inline = detectInlineDeck(html);
  if (inline.matches) {
    return {
      kind: 'inline-deck',
      confidence: 0.85,
      rootHtml,
      hints: {
        candidateRoots: [rootHtml],
        inlineSectionCount: inline.sectionCount,
        inlineSectionLabels: inline.labels,
      },
    };
  }

  return {
    kind: 'plain-html',
    confidence: 0.5,
    rootHtml,
    hints: { candidateRoots: [rootHtml] },
  };
}

function normalizeRelativePath(rootHtml: string, reference: string): string {
  const baseParts = rootHtml.split('/');
  baseParts.pop();

  const output = [...baseParts];
  for (const part of reference.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (output.length === 0) return reference;
      output.pop();
      continue;
    }
    output.push(part);
  }
  return output.join('/');
}
