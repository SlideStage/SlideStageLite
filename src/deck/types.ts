export type ArchitectureKind =
  | 'multi-file'
  | 'multi-file-flat'
  | 'single-file-deckstage'
  | 'single-file-html';

export interface ManifestProvenance {
  sourceKind?: string;
  conversionMode?: string;
  sourceEntry?: string;
  converter?: {
    name: string;
    version?: string;
  };
}

/**
 * Optional record of the external-asset mirror pass.
 *
 * `offline.ready === true` is the consumer contract: the deck's slide HTML
 * and CSS have been statically rewritten so every reference covered by the
 * mirror policy now points at a local `assets/_mirror/...` copy. Players
 * that see `ready === true` MUST NOT issue any external network request for
 * those resources; players that see `ready === false` keep their existing
 * external-resource fallbacks but should surface the partial state to the
 * user.
 */
export interface ManifestOffline {
  ready: boolean;
  mirroredAt: string;
  mirrorTool: { name: string; version?: string };
  policy?: ManifestOfflinePolicy;
  mirroredAssets: ManifestOfflineMirroredAsset[];
  skippedUrls: ManifestOfflineSkippedUrl[];
}

export interface ManifestOfflinePolicy {
  includeScripts: boolean;
  includeIframes: boolean;
  maxAssetBytes: number;
  maxTotalBytes: number;
  allowedHosts?: string[];
  blockedHosts?: string[];
}

export interface ManifestOfflineMirroredAsset {
  originalUrl: string;
  path: string;
  contentHash: string;
  contentType: string;
  bytes: number;
  fetchedAt: string;
  referencedBy: number[];
}

export type ManifestOfflineSkippedReason =
  | 'unreachable'
  | 'blocked-by-policy'
  | 'too-large'
  | 'unsupported-scheme'
  | 'budget-exhausted'
  | 'manual-skip';

export interface ManifestOfflineSkippedUrl {
  url: string;
  reason: ManifestOfflineSkippedReason;
  detail?: string;
}

export interface ManifestSlide {
  index: number;
  id: string;
  label: string;
  file: string;
  thumbnail: string | null;
  notes: string | null;
  duration?: number;
  transition?: string;
}

export interface Manifest {
  schema: 'hcslides@1.0';
  id: string;
  version: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  architecture: ArchitectureKind;
  dimensions: {
    width: number;
    height: number;
  };
  totalSlides: number;
  slides: ManifestSlide[];
  fonts?: unknown[];
  tokens?: Record<string, unknown>;
  assets?: unknown;
  runtime?: unknown;
  platform?: {
    minSchemaVersion?: string;
    compatibleArchitectures?: ArchitectureKind[];
  };
  provenance?: ManifestProvenance;
  compat?: {
    requires?: TrustCapability[];
    notes?: string;
  };
  offline?: ManifestOffline;
  stats?: unknown;
}

export type TrustCapability =
  | 'same-origin-storage'
  | 'broadcast-channel'
  | 'window-open';

export interface LoadedDeck {
  fileName: string;
  fingerprint: string;
  manifest: Manifest;
  /**
   * Per-slide `blob:` URLs. Used by the Web build (and as the iframe
   * `src` whenever `srcdoc` is unavailable / undesirable).
   */
  slideUrls: string[];
  /**
   * Per-slide *rewritten* HTML strings (assets already remapped to
   * blob: URLs). The desktop build feeds these into `<iframe srcdoc>`
   * because the Tauri WKWebView refuses to navigate iframes to
   * `blob:tauri://...` URLs (cross-origin under the custom scheme).
   *
   * Same length and order as `slideUrls`.
   */
  slideHtml: string[];
  thumbnailUrls: Array<string | null>;
  revoke: () => void;
}

export type DeckLoadErrorCode =
  | 'E_NOT_ZIP'
  | 'E_NO_MANIFEST'
  | 'E_BAD_MANIFEST'
  | 'E_UNSUPPORTED_SCHEMA'
  | 'E_PATH_TRAVERSAL'
  | 'E_MISSING_SLIDE'
  | 'E_TOO_LARGE'
  | 'E_NO_ENTRY_FOUND'
  | 'E_AMBIGUOUS_PACKAGE'
  | 'E_TRUST_REQUIRED'
  | 'E_TRUST_DENIED';

export class DeckLoadError extends Error {
  constructor(
    public readonly code: DeckLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeckLoadError';
  }
}
