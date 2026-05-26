import type {
  ArchitectureKind,
  DeckLoadErrorCode,
  SchemaLiteral,
  TrustCapability,
} from './constants';

// Re-export the manifest-describing type aliases that live in
// `./constants` (their values are tuple literals; the types are
// `(typeof T)[number]` derivations). Consumers can then pull every
// type they need to describe a parsed `.stage` manifest from
// `@slidestage/spec/types` in one place.
export type { ArchitectureKind, DeckLoadErrorCode, SchemaLiteral, TrustCapability };

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
  schema: SchemaLiteral;
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

/**
 * Standard error class raised by spec validators (`parseManifest`,
 * `normalizePackagePath`) and by consumer runtimes that need to signal
 * a .stage-related failure. The `code` is one of {@link DeckLoadErrorCode}
 * and is stable across versions so callers may pattern-match on it in
 * tests and UI strings.
 */
export class DeckLoadError extends Error {
  constructor(
    public readonly code: DeckLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeckLoadError';
  }
}
