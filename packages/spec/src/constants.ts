/**
 * Static `.stage` container constants.
 *
 * Every spec consumer (the Lite app, the Pro server, the standalone
 * `slidestage-pack` Agent skill) imports these values from here so they
 * cannot drift. Adding an entry is a SemVer minor; tightening or removing
 * one is a SemVer major.
 */

/** Manifest `schema` field literal — the package format identifier. */
export const SCHEMA_LITERAL = 'slidestage@1.0' as const;
export type SchemaLiteral = typeof SCHEMA_LITERAL;

/**
 * Highest `manifest.platform.minSchemaVersion` this spec accepts. A deck
 * declaring a higher number is rejected with `E_UNSUPPORTED_SCHEMA`.
 */
export const SUPPORTED_PLATFORM_SCHEMA_VERSION = '1.0' as const;

/**
 * `manifest.architecture` accepted values. The four entries describe how
 * the deck is physically arranged inside the zip; the runtime always
 * resolves them to "load `slides[].file` via iframe".
 */
export const ARCHITECTURES = [
  'multi-file',
  'multi-file-flat',
  'single-file-deckstage',
  'single-file-html',
] as const;
export type ArchitectureKind = (typeof ARCHITECTURES)[number];

/**
 * `manifest.compat.requires` accepted values. The runtime trust prompt
 * surfaces these to the user; unknown entries are dropped during
 * `parseManifest` (with a warning).
 *
 * Order matters: `parseManifest` sorts normalized capability lists
 * alphabetically so set-equality is byte-stable in storage, but the
 * trust prompt may render them in declaration order if it prefers.
 */
export const TRUST_CAPABILITIES = [
  'same-origin-storage',
  'broadcast-channel',
  'window-open',
] as const;
export type TrustCapability = (typeof TRUST_CAPABILITIES)[number];

/**
 * Base iframe `sandbox` token applied by the player before adding any
 * capability-specific tokens. Without `allow-scripts` even the simplest
 * deck cannot run.
 */
export const BASE_SANDBOX_TOKEN = 'allow-scripts' as const;

/**
 * Upper bound on `manifest.slides[].notes` length (~16 KB UTF-8 in the
 * common case). The validator does not measure note length — the cap is
 * a producer-side convention so the manifest stays a sane size — but it
 * lives here so every standard packer trims to the same boundary.
 */
export const MAX_NOTES_CHARS = 16_384 as const;

/**
 * Container, entry, and accounting limits.
 *
 * Pack-time enforcement is the producer's responsibility (the bundled
 * `pnpm convert pack` CLI and the `slidestage-pack` Agent skill both
 * gate on these numbers before writing). Load-time enforcement is the
 * consumer's responsibility (Lite's loader and Pro's upload pipeline
 * both gate on these numbers before parsing).
 */
export const SIZE_LIMITS = {
  /** Maximum size of the `.stage` zip itself, in bytes (200 MB). */
  packMax: 200 * 1024 * 1024,
  /** Maximum decompressed total of every entry, in bytes (1 GB). */
  decompressedTotalMax: 1024 * 1024 * 1024,
  /** Maximum size of a single zip entry, in bytes (100 MB). */
  entryMax: 100 * 1024 * 1024,
  /** Maximum size of a single slide HTML entry, in bytes (5 MB). */
  slideHtmlMax: 5 * 1024 * 1024,
  /** Maximum size of `manifest.json`, in bytes (5 MB). */
  manifestMax: 5 * 1024 * 1024,
  /** Maximum number of slides per deck. */
  totalSlidesMax: 500,
  /** Maximum number of annotation strokes per slide. */
  annotationStrokesPerSlideMax: 2_000,
  /** Maximum number of points per annotation stroke. */
  annotationPointsPerStrokeMax: 10_000,
} as const;
export type SizeLimits = typeof SIZE_LIMITS;

/**
 * Stable error codes raised by spec validators (`parseManifest`,
 * `normalizePackagePath`) and by consumer runtimes (Lite loader, Pro
 * upload pipeline).
 *
 * The first 11 entries describe failure modes of the .stage container
 * contract itself. The last 2 entries
 * (`E_TRANSPORT_PUBLISH_FAILED`, `E_TOO_LARGE_FOR_INLINE`) describe
 * implementation-specific browser failure modes; they live here so the
 * union type is one place, but spec validators never raise them.
 */
export const DECK_LOAD_ERROR_CODES = [
  'E_NOT_ZIP',
  'E_NO_MANIFEST',
  'E_BAD_MANIFEST',
  'E_UNSUPPORTED_SCHEMA',
  'E_PATH_TRAVERSAL',
  'E_MISSING_SLIDE',
  'E_TOO_LARGE',
  'E_NO_ENTRY_FOUND',
  'E_AMBIGUOUS_PACKAGE',
  'E_TRUST_REQUIRED',
  'E_TRUST_DENIED',
  'E_TRANSPORT_PUBLISH_FAILED',
  'E_TOO_LARGE_FOR_INLINE',
] as const;
export type DeckLoadErrorCode = (typeof DECK_LOAD_ERROR_CODES)[number];
