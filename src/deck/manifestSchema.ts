import { z } from 'zod';
import { DeckLoadError, type Manifest, type TrustCapability } from './types';

const architectureSchema = z.enum([
  'multi-file',
  'multi-file-flat',
  'single-file-deckstage',
  'single-file-html',
]);

const supportedPlatformSchemaVersion = '1.0';
const knownTrustCapabilities = new Set<TrustCapability>([
  'same-origin-storage',
  'broadcast-channel',
  'window-open',
]);

const nullableString = z.string().nullable();

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes('\0'), 'manifest.id must not contain NUL')
  .refine((value) => !value.includes('/'), 'manifest.id must not contain "/"')
  .refine((value) => !value.includes('\\'), 'manifest.id must not contain "\\"')
  .refine((value) => !value.includes('..'), 'manifest.id must not contain ".."')
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'manifest.id must not contain control characters');

export const manifestSchema = z
  .object({
    schema: z.literal('hcslides@1.0'),
    id: idSchema,
    version: z.string().min(1).max(64),
    title: z.string().min(1).max(256),
    subtitle: nullableString,
    author: nullableString,
    description: nullableString,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    architecture: architectureSchema,
    dimensions: z.object({
      width: z.number().positive().finite(),
      height: z.number().positive().finite(),
    }),
    totalSlides: z.number().int().positive().max(500),
    slides: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            id: z.string().min(1).max(128),
            label: z.string().min(1).max(256),
            file: z.string().min(1),
            thumbnail: nullableString,
            notes: nullableString,
            duration: z.number().positive().optional(),
            transition: z.string().max(64).optional(),
          })
          .passthrough(),
      )
      .min(1)
      .max(500),
    fonts: z.array(z.unknown()).optional(),
    tokens: z.record(z.string(), z.unknown()).optional(),
    assets: z.unknown().optional(),
    runtime: z.unknown().optional(),
    platform: z
      .object({
        minSchemaVersion: z.string().optional(),
        compatibleArchitectures: z.array(architectureSchema).optional(),
      })
      .passthrough()
      .optional(),
    provenance: z
      .object({
        sourceKind: z.string().min(1).max(128).optional(),
        conversionMode: z.string().min(1).max(64).optional(),
        sourceEntry: z.string().min(1).max(512).optional(),
        converter: z
          .object({
            name: z.string().min(1).max(128),
            version: z.string().min(1).max(64).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    compat: z
      .object({
        requires: z.array(z.string()).optional(),
        notes: z.string().max(1024).optional(),
      })
      .passthrough()
      .optional(),
    offline: z
      .object({
        ready: z.boolean(),
        mirroredAt: z.string().min(1),
        mirrorTool: z
          .object({
            name: z.string().min(1).max(128),
            version: z.string().min(1).max(64).optional(),
          })
          .passthrough(),
        policy: z
          .object({
            includeScripts: z.boolean(),
            includeIframes: z.boolean(),
            maxAssetBytes: z.number().int().nonnegative(),
            maxTotalBytes: z.number().int().nonnegative(),
            allowedHosts: z.array(z.string().min(1)).optional(),
            blockedHosts: z.array(z.string().min(1)).optional(),
          })
          .passthrough()
          .optional(),
        mirroredAssets: z
          .array(
            z
              .object({
                originalUrl: z.string().min(1),
                path: z.string().min(1),
                contentHash: z.string().min(1),
                contentType: z.string().min(1),
                bytes: z.number().int().nonnegative(),
                fetchedAt: z.string().min(1),
                referencedBy: z.array(z.number().int().nonnegative()).default([]),
              })
              .passthrough(),
          )
          .default([]),
        skippedUrls: z
          .array(
            z
              .object({
                url: z.string().min(1),
                reason: z.enum([
                  'unreachable',
                  'blocked-by-policy',
                  'too-large',
                  'unsupported-scheme',
                  'budget-exhausted',
                  'manual-skip',
                ]),
                detail: z.string().max(1024).optional(),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .optional(),
    stats: z.unknown().optional(),
  })
  .passthrough();

export type ParseManifestOptions = {
  onWarning?: (warning: ManifestWarning) => void;
};

export type ManifestWarning =
  | { code: 'totalSlidesMismatch'; declared: number; actual: number }
  | { code: 'slideIndexRenumbered'; originalIndices: number[] }
  | { code: 'unknownCompatCapability'; capability: string };

export function parseManifest(value: unknown, options: ParseManifestOptions = {}): Manifest {
  const parsed = manifestSchema.parse(value) as Manifest;
  return normalizeManifest(parsed, options.onWarning);
}

function normalizeManifest(
  manifest: Manifest,
  onWarning?: (warning: ManifestWarning) => void,
): Manifest {
  validatePlatformVersion(manifest);
  normalizeCompatRequires(manifest, onWarning);

  const actualLength = manifest.slides.length;
  if (manifest.totalSlides !== actualLength) {
    onWarning?.({
      code: 'totalSlidesMismatch',
      declared: manifest.totalSlides,
      actual: actualLength,
    });
    if (typeof console !== 'undefined') {
      console.warn(
        `[hcslides] manifest.totalSlides (${manifest.totalSlides}) does not match slides.length (${actualLength}); using slides.length.`,
      );
    }
    manifest.totalSlides = actualLength;
  }

  const originalIndices = manifest.slides.map((slide) => slide.index);
  const needsRenumber = manifest.slides.some((slide, idx) => slide.index !== idx + 1);
  if (needsRenumber) {
    onWarning?.({ code: 'slideIndexRenumbered', originalIndices });
    if (typeof console !== 'undefined') {
      console.warn(
        `[hcslides] slides[].index was not sequential (${originalIndices.join(', ')}); renumbering by array order.`,
      );
    }
    manifest.slides = manifest.slides.map((slide, idx) => ({
      ...slide,
      index: idx + 1,
    }));
  }

  return manifest;
}

function validatePlatformVersion(manifest: Manifest): void {
  const minVersion = manifest.platform?.minSchemaVersion;
  if (!minVersion) return;
  if (compareSemver(minVersion, supportedPlatformSchemaVersion) > 0) {
    throw new DeckLoadError(
      'E_UNSUPPORTED_SCHEMA',
      `manifest requires platform schema >= ${minVersion}, but Lite supports ${supportedPlatformSchemaVersion}.`,
    );
  }
}

function normalizeCompatRequires(
  manifest: Manifest,
  onWarning?: (warning: ManifestWarning) => void,
): void {
  const requested = manifest.compat?.requires;
  if (!requested || requested.length === 0) return;

  const normalized: TrustCapability[] = [];
  const seen = new Set<TrustCapability>();
  for (const candidate of requested as string[]) {
    if (!knownTrustCapabilities.has(candidate as TrustCapability)) {
      onWarning?.({ code: 'unknownCompatCapability', capability: candidate });
      if (typeof console !== 'undefined') {
        console.warn(
          `[hcslides] manifest.compat.requires contains unknown capability "${candidate}"; ignoring it.`,
        );
      }
      continue;
    }
    const capability = candidate as TrustCapability;
    if (seen.has(capability)) continue;
    seen.add(capability);
    normalized.push(capability);
  }

  normalized.sort();
  manifest.compat = {
    ...(manifest.compat ?? {}),
    requires: normalized,
  };
}

function compareSemver(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part) || 0);
  const right = b.split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
