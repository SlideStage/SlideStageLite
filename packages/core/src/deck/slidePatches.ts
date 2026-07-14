// In-place slide text patches.
//
// A patch records one user edit made in the viewer's edit mode: "the
// element at `selector` whose text was `before` should now read `after`".
// Patches never touch the `.stage` archive bytes — they are applied at
// load time (see `LoadDeckOptions.transformSlideHtml`) and, on explicit
// export, to a repacked copy. The deck fingerprint (sha256 of the zip
// bytes) therefore stays stable and all per-deck persistence (trust,
// annotations, notes) keeps working while edits exist.
//
// Selectors are STRUCTURAL ONLY: `body>tag:nth-of-type(n)>...`. The edit
// agent generates exactly this shape and every boundary (agent → host
// message, localStorage hydrate, patch application) re-validates against
// {@link SLIDE_PATCH_SELECTOR_RE} so an untrusted slide cannot smuggle
// exotic selectors into `querySelector`.
//
// Patch application assigns `textContent` only. No HTML ever crosses from
// the edit channel into slide markup, so there is no injection surface.

/** One recorded text edit. */
export interface SlideTextPatch {
  /** Structural path from `body`, e.g. `body>main:nth-of-type(1)>h1:nth-of-type(1)`. */
  selector: string;
  /** Text content observed when the edit was made (application anchor). */
  before: string;
  /** Replacement text content. */
  after: string;
}

/**
 * The only selector grammar accepted end-to-end. Mirrors what the edit
 * agent emits: `body` followed by zero or more `>tag:nth-of-type(n)`
 * segments. Tag names are HTML/custom-element flavored (letters, digits,
 * dashes), the index is 1-4 digits.
 */
export const SLIDE_PATCH_SELECTOR_RE =
  /^body(?:>[a-z][a-z0-9-]*:nth-of-type\(\d{1,4}\))*$/;

/** Upper bound for `before` / `after` text, matched by the edit agent. */
export const MAX_SLIDE_PATCH_TEXT_LENGTH = 10000;

/** Upper bound for the structural selector, matched by the edit agent. */
export const MAX_SLIDE_PATCH_SELECTOR_LENGTH = 1000;

/** Validate an untrusted value as a {@link SlideTextPatch}. */
export function isValidSlideTextPatch(value: unknown): value is SlideTextPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const patch = value as Partial<SlideTextPatch>;
  if (typeof patch.selector !== 'string' || typeof patch.before !== 'string' || typeof patch.after !== 'string') {
    return false;
  }
  if (patch.selector.length === 0 || patch.selector.length > MAX_SLIDE_PATCH_SELECTOR_LENGTH) return false;
  if (!SLIDE_PATCH_SELECTOR_RE.test(patch.selector)) return false;
  if (patch.before.length > MAX_SLIDE_PATCH_TEXT_LENGTH) return false;
  if (patch.after.length > MAX_SLIDE_PATCH_TEXT_LENGTH) return false;
  return true;
}

export interface ApplySlidePatchesResult {
  /** Patched HTML (the input string when nothing applied). */
  html: string;
  /** Patches whose target was found and text replaced (or already replaced). */
  applied: number;
  /** Patches skipped because the selector or `before` anchor no longer matches. */
  failed: number;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function serializeDoctype(doctype: DocumentType | null): string {
  if (!doctype) return '';
  let out = `<!DOCTYPE ${doctype.name}`;
  if (doctype.publicId) {
    out += ` PUBLIC "${doctype.publicId}"`;
    if (doctype.systemId) out += ` "${doctype.systemId}"`;
  } else if (doctype.systemId) {
    out += ` SYSTEM "${doctype.systemId}"`;
  }
  return `${out}>`;
}

/**
 * Apply text patches to a slide's raw HTML.
 *
 * Selectors were computed against the *running* slide DOM but are applied
 * to the static HTML, so mismatches are expected for decks whose scripts
 * rebuild the DOM (wrap-mode conversions, SPA-style slides). A patch is
 * applied only when the selector resolves AND the element's current text
 * matches `before` (exactly, or after whitespace collapsing) — anything
 * else is counted in `failed` and the slide is left intact rather than
 * corrupted. Re-applying is idempotent: an element that already carries
 * `after` counts as applied.
 *
 * Runs `DOMParser` over the slide (browser / jsdom environments). When no
 * patch applies, the original string is returned byte-for-byte so callers
 * can cheaply detect "nothing changed".
 */
export function applySlidePatchesToHtml(
  html: string,
  patches: ReadonlyArray<SlideTextPatch>,
): ApplySlidePatchesResult {
  if (patches.length === 0) return { html, applied: 0, failed: 0 };

  let doc: Document | null = null;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    doc = null;
  }
  if (!doc || !doc.documentElement || !doc.body) {
    return { html, applied: 0, failed: patches.length };
  }

  let applied = 0;
  let failed = 0;
  let mutated = false;

  for (const patch of patches) {
    if (!isValidSlideTextPatch(patch)) {
      failed += 1;
      continue;
    }
    let el: Element | null = null;
    try {
      el = doc.querySelector(patch.selector);
    } catch {
      el = null;
    }
    if (!el) {
      failed += 1;
      continue;
    }
    const current = el.textContent ?? '';
    if (current === patch.after) {
      applied += 1;
      continue;
    }
    if (current === patch.before || collapseWhitespace(current) === collapseWhitespace(patch.before)) {
      el.textContent = patch.after;
      applied += 1;
      mutated = true;
      continue;
    }
    failed += 1;
  }

  if (!mutated) return { html, applied, failed };

  const doctype = serializeDoctype(doc.doctype);
  const serialized = `${doctype}${doctype ? '\n' : ''}${doc.documentElement.outerHTML}`;
  return { html: serialized, applied, failed };
}
